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

let db: Database.Database;

// Additional tables for memory
const MEMORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS memory_facts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    fact TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    importance INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );

  CREATE TABLE IF NOT EXISTS conversation_summaries (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    message_count INTEGER DEFAULT 0,
    token_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  );

  CREATE TABLE IF NOT EXISTS workspace_index (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL UNIQUE,
    file_type TEXT,
    summary TEXT,
    last_indexed TEXT NOT NULL,
    size_bytes INTEGER DEFAULT 0
  );
`;

export function registerMemoryHandlers(database: Database.Database) {
  db = database;

  // Initialize memory tables
  db.exec(MEMORY_SCHEMA);

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
  ipcMain.handle('memory:saveSummary', async (_event, summary: {
    conversationId: string;
    summary: string;
    messageCount: number;
    tokenCount: number;
  }) => {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO conversation_summaries (id, conversation_id, summary, message_count, token_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      summary.conversationId,
      summary.summary,
      summary.messageCount,
      summary.tokenCount,
      new Date().toISOString()
    );
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

  // Build context for AI calls — combines recent facts, conversation history, and relevant workspace files
  ipcMain.handle('memory:buildContext', async (_event, params: {
    conversationId?: string;
    query?: string;
    maxTokens?: number;
  }) => {
    const context: string[] = [];
    const maxTokens = params.maxTokens || 2000;

    // 1. Get high-importance facts
    const facts = db.prepare(`
      SELECT fact, category FROM memory_facts 
      ORDER BY importance DESC, created_at DESC 
      LIMIT 10
    `).all() as any[];

    if (facts.length > 0) {
      context.push('## Known Facts');
      facts.forEach((f: any) => {
        context.push(`- [${f.category}] ${f.fact}`);
      });
    }

    // 2. Get conversation summary if available
    if (params.conversationId) {
      const summary = db.prepare(`
        SELECT summary FROM conversation_summaries 
        WHERE conversation_id = ? 
        ORDER BY created_at DESC LIMIT 1
      `).get(params.conversationId) as any;

      if (summary) {
        context.push('\n## Conversation Context');
        context.push(summary.summary);
      }
    }

    // 3. Search workspace for relevant files
    if (params.query) {
      const files = db.prepare(`
        SELECT file_path, summary FROM workspace_index 
        WHERE file_path LIKE ? OR summary LIKE ?
        LIMIT 5
      `).all(`%${params.query}%`, `%${params.query}%`) as any[];

      if (files.length > 0) {
        context.push('\n## Relevant Workspace Files');
        files.forEach((f: any) => {
          context.push(`- ${f.file_path}: ${f.summary}`);
        });
      }
    }

    const contextStr = context.join('\n');
    // Rough token estimate (4 chars ≈ 1 token)
    const estimatedTokens = Math.ceil(contextStr.length / 4);

    return {
      context: contextStr,
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
