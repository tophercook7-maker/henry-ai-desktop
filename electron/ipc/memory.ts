/**
 * Memory System — Conversation context and workspace knowledge.
 * 
 * Provides:
 * - Conversation summarization for long-running threads
 * - Key fact extraction from conversations
 * - Workspace file indexing for context-aware responses
 * - Smart context window management
 */

import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import type { HenryLeanMemoryParts } from '../../src/types';

let db: Database.Database;

export function registerMemoryHandlers(database: Database.Database) {
  db = database;
  // Tables are created in database.ts → initDatabase()

  // Save a fact extracted from conversation
  ipcMain.handle('memory:saveFact', async (_event, fact: {
    conversationId?: string;
    fact: string;
    category?: string;
    importance?: number;
  }) => {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO memory_facts (id, conversation_id, fact, category, importance, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      fact.conversationId || null,
      fact.fact,
      fact.category || 'general',
      fact.importance || 1,
      new Date().toISOString()
    );
    return { id };
  });

  // Search facts
  ipcMain.handle('memory:searchFacts', async (_event, query: {
    text?: string;
    category?: string;
    conversationId?: string;
    limit?: number;
  }) => {
    let sql = 'SELECT * FROM memory_facts WHERE 1=1';
    const params: any[] = [];

    if (query.text) {
      sql += ' AND fact LIKE ?';
      params.push(`%${query.text}%`);
    }
    if (query.category) {
      sql += ' AND category = ?';
      params.push(query.category);
    }
    if (query.conversationId) {
      sql += ' AND conversation_id = ?';
      params.push(query.conversationId);
    }

    sql += ' ORDER BY importance DESC, created_at DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    return db.prepare(sql).all(...params);
  });

  // Get all facts for context building
  ipcMain.handle('memory:getAllFacts', async (_event, limit?: number) => {
    return db.prepare(`
      SELECT * FROM memory_facts 
      ORDER BY importance DESC, created_at DESC 
      LIMIT ?
    `).all(limit || 50);
  });

  // Save conversation summary
  ipcMain.handle('memory:saveSummary', async (_event, payload: Record<string, unknown>) => {
    const conversationId =
      (typeof payload.conversationId === 'string' && payload.conversationId) ||
      (typeof payload.conversation_id === 'string' && payload.conversation_id) ||
      '';
    const summaryText = typeof payload.summary === 'string' ? payload.summary : '';
    if (!conversationId.trim() || !summaryText.trim()) {
      return { id: null as string | null, error: 'conversationId and summary are required.' };
    }
    const messageCount =
      typeof payload.messageCount === 'number'
        ? payload.messageCount
        : typeof payload.message_count === 'number'
          ? payload.message_count
          : 0;
    const tokenCount =
      typeof payload.tokenCount === 'number'
        ? payload.tokenCount
        : typeof payload.token_count === 'number'
          ? payload.token_count
          : Math.ceil(summaryText.length / 4);
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO conversation_summaries (id, conversation_id, summary, message_count, token_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, conversationId, summaryText, messageCount, tokenCount, new Date().toISOString());
    return { id };
  });

  // Get latest summary for a conversation
  ipcMain.handle('memory:getSummary', async (_event, conversationId: string) => {
    return db.prepare(`
      SELECT * FROM conversation_summaries 
      WHERE conversation_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `).get(conversationId);
  });

  // Index a workspace file
  ipcMain.handle('memory:indexFile', async (_event, file: {
    path: string;
    type: string;
    summary: string;
    sizeBytes: number;
  }) => {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT OR REPLACE INTO workspace_index (id, file_path, file_type, summary, last_indexed, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, file.path, file.type, file.summary, new Date().toISOString(), file.sizeBytes);
    return { id };
  });

  // Search workspace index
  ipcMain.handle('memory:searchWorkspace', async (_event, query: string) => {
    return db.prepare(`
      SELECT * FROM workspace_index 
      WHERE file_path LIKE ? OR summary LIKE ?
      ORDER BY last_indexed DESC
      LIMIT 20
    `).all(`%${query}%`, `%${query}%`);
  });

  // Build lean context for AI — structured slices only; formatting is `src/henry/memoryContext.ts`
  ipcMain.handle('memory:buildContext', async (_event, params: {
    conversationId?: string;
    query?: string;
    /** Soft cap on fact rows read from DB before renderer dedupes */
    maxFactsFetch?: number;
  }) => {
    const conversationId = params.conversationId;
    const q = typeof params.query === 'string' ? params.query.trim() : '';
    const factFetchCap = Math.min(Math.max(params.maxFactsFetch ?? 40, 10), 80);

    type FactRow = { fact: string; category: string };
    let factRows: FactRow[] = [];

    if (conversationId) {
      factRows = db
        .prepare(
          `
        SELECT fact, category FROM memory_facts 
        WHERE conversation_id IS NULL OR conversation_id = ?
        ORDER BY 
          CASE WHEN conversation_id = ? THEN 0 ELSE 1 END,
          importance DESC,
          created_at DESC
        LIMIT ?
      `
        )
        .all(conversationId, conversationId, factFetchCap) as FactRow[];
    } else {
      factRows = db
        .prepare(
          `
        SELECT fact, category FROM memory_facts 
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
      `
        )
        .all(factFetchCap) as FactRow[];
    }

    const facts: HenryLeanMemoryParts['facts'] = factRows.map((r) => ({
      fact: r.fact,
      category: r.category || 'general',
    }));

    let conversationSummary: string | null = null;
    if (conversationId) {
      const summary = db
        .prepare(
          `
        SELECT summary FROM conversation_summaries 
        WHERE conversation_id = ? 
        ORDER BY created_at DESC LIMIT 1
      `
        )
        .get(conversationId) as { summary: string } | undefined;
      conversationSummary = summary?.summary ?? null;
    }

    let workspaceHints: Array<{ file_path: string; summary: string }> = [];
    if (q) {
      const like = `%${q}%`;
      const files = db
        .prepare(
          `
        SELECT file_path, summary FROM workspace_index 
        WHERE file_path LIKE ? OR summary LIKE ?
        ORDER BY last_indexed DESC
        LIMIT 5
      `
        )
        .all(like, like) as { file_path: string; summary: string }[];

      workspaceHints = files.slice(0, 3).map((f) => ({
        file_path: f.file_path,
        summary: f.summary || '',
      }));
    }

    const lean: HenryLeanMemoryParts = {
      conversationSummary,
      facts,
      workspaceHints,
    };

    const blob = JSON.stringify(lean);
    const estimatedTokens = Math.ceil(blob.length / 4);

    return {
      lean,
      estimatedTokens,
      factCount: facts.length,
    };
  });

  // Delete a fact
  ipcMain.handle('memory:deleteFact', async (_event, factId: string) => {
    db.prepare('DELETE FROM memory_facts WHERE id = ?').run(factId);
    return { deleted: true };
  });

  // Clear all memory for a conversation
  ipcMain.handle('memory:clearConversation', async (_event, conversationId: string) => {
    db.prepare('DELETE FROM memory_facts WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?').run(conversationId);
    return { cleared: true };
  });
}

/**
 * Utility: Extract facts from a conversation message.
 * Called by the AI handler after each response to build memory.
 */
export function extractFactsFromMessage(content: string): string[] {
  // Simple heuristic fact extraction
  // In Phase 3, this will use AI to extract structured facts
  const facts: string[] = [];

  // Look for key patterns
  const patterns = [
    /(?:my name is|i'm called|call me)\s+(\w+)/gi,
    /(?:i work (?:at|for|with))\s+(.+?)(?:\.|,|$)/gi,
    /(?:the (?:project|company|team) is)\s+(.+?)(?:\.|,|$)/gi,
    /(?:(?:use|using|prefer|want)\s+)(\w+(?:\s+\w+)?)\s+(?:for|as|to)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      facts.push(match[0].trim());
    }
  }

  return facts;
}
