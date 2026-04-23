/**
 * Henry Memory System — Full 7-Layer Memory Blueprint
 *
 * Layers:
 *   1 — Live Turn (current message, handled in ChatView)
 *   2 — Session Memory (per-conversation summaries + active state)
 *   3 — Working Memory (rolling cross-session buffer, DB-backed)
 *   4 — Long-Term Personal Memory (personal_memory table, scored)
 *   5 — Project Memory (projects + project_memory tables)
 *   6 — Relationship Memory (support style, pattern recognition)
 *   7 — Narrative Memory (life/work arcs, milestones)
 *
 * Plus: memory scoring engine, bandwidth modes, compression,
 *       where-we-left-off, and memory graph edges.
 */

import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import type { HenryLeanMemoryParts } from '../../src/types';

let db: Database.Database;

// ── Scoring formula (from blueprint section 5) ────────────────────────────────
// retrieval_score = (relevance*0.30) + (recency*0.20) + (emotional*0.15)
//                 + (strategic*0.25) + (confidence*0.10)
function computeRetrievalScore(row: {
  relevance_score?: number;
  recency_score?: number;
  emotional_significance_score?: number;
  strategic_significance_score?: number;
  confidence_score?: number;
  created_at?: string;
}): number {
  const relevance  = row.relevance_score  ?? 0.5;
  const emotional  = row.emotional_significance_score ?? 0.3;
  const strategic  = row.strategic_significance_score ?? 0.5;
  const confidence = row.confidence_score ?? 0.7;

  // Recency: decays over 90 days
  let recency = row.recency_score ?? 1.0;
  if (row.created_at) {
    const ageDays = (Date.now() - new Date(row.created_at).getTime()) / 86_400_000;
    recency = Math.max(0, 1 - ageDays / 90);
  }

  return (relevance  * 0.30)
       + (recency    * 0.20)
       + (emotional  * 0.15)
       + (strategic  * 0.25)
       + (confidence * 0.10);
}

// ── Registration ──────────────────────────────────────────────────────────────

// ── Safe DB helper — wraps any IPC handler body to prevent main-process crashes ──
function safeHandle<T>(channel: string, fn: () => T): T {
  try {
    return fn();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${channel}] DB error:`, msg);
    throw new Error(`Henry memory error: ${msg}`);
  }
}


export function registerMemoryHandlers(database: Database.Database) {
  db = database;

  // ══════════════════════════════════════════════════════════════════════
  // LEGACY — keep backward-compatible channels for memory_facts
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:saveFact', async (_e, fact: {
    conversationId?: string; conversation_id?: string;
    fact: string;
    category?: string;
    importance?: number;
  }) => {
    try {
      const convId = fact.conversationId || fact.conversation_id || null;
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO memory_facts (id, conversation_id, fact, category, importance, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, convId, fact.fact, fact.category || 'general', fact.importance || 1, new Date().toISOString());

      // Mirror into personal_memory for scored retrieval
      db.prepare(`
        INSERT INTO personal_memory
          (id, memory_key, memory_value, memory_type, confidence_score, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        fact.category || 'general',
        fact.fact,
        fact.category || 'general',
        (fact.importance || 1) / 10,
        new Date().toISOString(),
        new Date().toISOString(),
      );
      return { id };
    } catch (e: unknown) {
      console.error('[memory:saveFact]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:searchFacts', async (_e, query: {
    text?: string; category?: string; conversationId?: string; limit?: number;
  }) => {
    const limit = query.limit || 40;
    // Use FTS5 for full-text queries — falls back to LIKE if FTS table not ready
    if (query.text && query.text.trim()) {
      try {
        // FTS5: rank by relevance, apply secondary filters in the outer query
        let sql = `
          SELECT mf.* FROM memory_facts mf
          JOIN memory_facts_fts fts ON mf.rowid = fts.rowid
          WHERE memory_facts_fts MATCH ?
        `;
        const params: (string | number)[] = [query.text.trim().replace(/['"*^]/g, '') + '*'];
        if (query.category)       { sql += ' AND mf.category = ?';         params.push(query.category); }
        if (query.conversationId) { sql += ' AND mf.conversation_id = ?';  params.push(query.conversationId); }
        sql += ' ORDER BY fts.rank, mf.importance DESC, mf.created_at DESC LIMIT ?';
        params.push(limit);
        return db.prepare(sql).all(...params);
      } catch {
        // FTS not yet populated — fall through to LIKE
      }
    }
    // Fallback LIKE path (no text query, or FTS not ready)
    let sql = 'SELECT * FROM memory_facts WHERE 1=1';
    const params: (string | number)[] = [];
    if (query.text)           { sql += ' AND fact LIKE ?';           params.push(`%${query.text}%`); }
    if (query.category)       { sql += ' AND category = ?';          params.push(query.category); }
    if (query.conversationId) { sql += ' AND conversation_id = ?';   params.push(query.conversationId); }
    sql += ' ORDER BY importance DESC, created_at DESC LIMIT ?';
    params.push(limit);
    return db.prepare(sql).all(...params);
  });

  ipcMain.handle('memory:getAllFacts', async (_e, limit?: number) =>
    db.prepare(`SELECT * FROM memory_facts ORDER BY importance DESC, created_at DESC LIMIT ?`)
      .all(limit || 50)
  );

  ipcMain.handle('memory:deleteFact', async (_e, factId: string) => {
    try {
      db.prepare('DELETE FROM memory_facts WHERE id = ?').run(factId);
      return { deleted: true };
    } catch (e: unknown) {
      console.error('[memory:deleteFact]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:clearConversation', async (_e, conversationId: string) => {
    try {
      db.prepare('DELETE FROM memory_facts WHERE conversation_id = ?').run(conversationId);
      db.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?').run(conversationId);
      return { cleared: true };
    } catch (e: unknown) {
      console.error('[memory:clearConversation]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // CONVERSATION SUMMARIES
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:saveSummary', async (_e, payload: Record<string, unknown>) => {
    try {
      const conversationId =
        (typeof payload.conversationId === 'string' && payload.conversationId) ||
        (typeof payload.conversation_id === 'string' && payload.conversation_id) || '';
      const summaryText = typeof payload.summary === 'string' ? payload.summary : '';
      if (!conversationId.trim() || !summaryText.trim())
        return { id: null as string | null, error: 'conversationId and summary are required.' };
      const messageCount = (typeof payload.messageCount === 'number' ? payload.messageCount
        : typeof payload.message_count === 'number' ? payload.message_count : 0);
      const tokenCount = (typeof payload.tokenCount === 'number' ? payload.tokenCount
        : typeof payload.token_count === 'number' ? payload.token_count
        : Math.ceil(summaryText.length / 4));
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO conversation_summaries (id, conversation_id, summary, message_count, token_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, conversationId, summaryText, messageCount, tokenCount, new Date().toISOString());
      return { id };
    } catch (e: unknown) {
      console.error('[memory:saveSummary]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:getSummary', async (_e, conversationId: string) =>
    db.prepare(`SELECT * FROM conversation_summaries WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(conversationId)
  );

  // ══════════════════════════════════════════════════════════════════════
  // WORKSPACE INDEX
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:indexFile', async (_e, file: {
    path: string; type: string; summary: string; sizeBytes: number;
  }) => {
    try {
      const id = crypto.randomUUID();
      db.prepare(`INSERT OR REPLACE INTO workspace_index (id, file_path, file_type, summary, last_indexed, size_bytes) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, file.path, file.type, file.summary, new Date().toISOString(), file.sizeBytes);
      return { id };
    } catch (e: unknown) {
      console.error('[memory:indexFile]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:searchWorkspace', async (_e, query: string) => {
    if (!query.trim()) return [];
    try {
      // Try FTS5 on workspace_index if available, else fall back to LIKE
      return db.prepare(`SELECT * FROM workspace_index WHERE file_path LIKE ? OR summary LIKE ? ORDER BY last_indexed DESC LIMIT 20`)
        .all(`%${query}%`, `%${query}%`);
    } catch {
      return [];
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // LAYER 4 — PERSONAL MEMORY (scored, typed)
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:savePersonalMemory', async (_e, item: {
    memoryKey: string;
    memoryValue: string;
    memoryType?: string;
    summary?: string;
    source?: string;
    confidenceScore?: number;
    emotionalSignificanceScore?: number;
    strategicSignificanceScore?: number;
    tags?: string[];
  }) => {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO personal_memory
          (id, memory_key, memory_value, memory_type, summary, source,
           confidence_score, emotional_significance_score, strategic_significance_score,
           tags_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, item.memoryKey, item.memoryValue, item.memoryType || 'general',
        item.summary || null, item.source || null,
        item.confidenceScore ?? 0.7,
        item.emotionalSignificanceScore ?? 0.3,
        item.strategicSignificanceScore ?? 0.5,
        JSON.stringify(item.tags || []),
        now, now,
      );
      return { id };
    } catch (e: unknown) {
      console.error('[memory:savePersonalMemory]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:getPersonalMemory', async (_e, opts: {
    memoryType?: string; limit?: number; activeOnly?: boolean;
  } = {}) => {
    try {
      let sql = 'SELECT * FROM personal_memory WHERE 1=1';
      const params: (string | number)[] = [];
      if (opts.activeOnly !== false) { sql += ' AND active_status = 1'; }
      if (opts.memoryType)           { sql += ' AND memory_type = ?'; params.push(opts.memoryType); }
      sql += ' ORDER BY strategic_significance_score DESC, emotional_significance_score DESC, created_at DESC LIMIT ?';
      params.push(opts.limit || 50);
      const rows = db.prepare(sql).all(...params) as any[];
      return rows
        .map((r) => ({ ...r, _retrieval_score: computeRetrievalScore(r) }))
        .sort((a, b) => b._retrieval_score - a._retrieval_score);
    } catch (e: unknown) {
      console.error('[memory:getPersonalMemory]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:updatePersonalMemory', async (_e, id: string, updates: Record<string, unknown>) => {
    try {
      const allowed = ['memory_value','summary','confidence_score','emotional_significance_score',
                       'strategic_significance_score','active_status','tags_json'];
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const key of allowed) {
        if (key in updates) { sets.push(`${key} = ?`); vals.push(updates[key]); }
      }
      if (sets.length === 0) return { updated: false };
      sets.push('updated_at = ?');
      vals.push(new Date().toISOString());
      vals.push(id);
      db.prepare(`UPDATE personal_memory SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return { updated: true };
    } catch (e: unknown) {
      console.error('[memory:updatePersonalMemory]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:deletePersonalMemory', async (_e, id: string) => {
    try {
      db.prepare('UPDATE personal_memory SET active_status = 0, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), id);
      return { deleted: true };
    } catch (e: unknown) {
      console.error('[memory:deletePersonalMemory]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:recallPersonalMemory', async (_e, id: string) => {
    try {
      db.prepare('UPDATE personal_memory SET last_recalled_at = ? WHERE id = ?')
        .run(new Date().toISOString(), id);
    } catch (e: unknown) {
      console.error('[memory:recallPersonalMemory]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // LAYER 5 — PROJECTS
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:saveProject', async (_e, project: {
    name: string; type?: string; summary?: string;
    strategicImportanceScore?: number; emotionalImportanceScore?: number;
  }) => {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO projects (id, name, type, summary, strategic_importance_score, emotional_importance_score, created_at, updated_at, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, project.name, project.type || 'general', project.summary || null,
             project.strategicImportanceScore ?? 0.5, project.emotionalImportanceScore ?? 0.5,
             now, now, now);
      return { id };
    } catch (e: unknown) {
      console.error('[memory:saveProject]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:getProjects', async (_e, opts: { status?: string; limit?: number } = {}) => {
    try {
      let sql = 'SELECT * FROM projects WHERE 1=1';
      const params: (string | number)[] = [];
      if (opts.status) { sql += ' AND status = ?'; params.push(opts.status); }
      sql += ' ORDER BY strategic_importance_score DESC, last_active_at DESC LIMIT ?';
      params.push(opts.limit || 20);
      return db.prepare(sql).all(...params);
    } catch (e: unknown) {
      console.error('[memory:getProjects]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:updateProject', async (_e, id: string, updates: Record<string, unknown>) => {
    try {
      const allowed = ['name','type','status','summary','strategic_importance_score','emotional_importance_score'];
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const k of allowed) { if (k in updates) { sets.push(`${k} = ?`); vals.push(updates[k]); } }
      if (sets.length === 0) return { updated: false };
      sets.push('updated_at = ?', 'last_active_at = ?');
      const now = new Date().toISOString();
      vals.push(now, now, id);
      db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return { updated: true };
    } catch (e: unknown) {
      console.error('[memory:updateProject]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:saveProjectMemory', async (_e, item: {
    projectId: string; memoryKey: string; memoryValue: string;
    summary?: string; blockerFlag?: boolean; deadline?: string;
    confidenceScore?: number; relevanceScore?: number;
  }) => {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO project_memory
          (id, project_id, memory_key, memory_value, summary, blocker_flag, deadline,
           confidence_score, relevance_score, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, item.projectId, item.memoryKey, item.memoryValue,
             item.summary || null, item.blockerFlag ? 1 : 0,
             item.deadline || null, item.confidenceScore ?? 0.8, item.relevanceScore ?? 0.7,
             now, now);
      // Touch project last_active_at
      db.prepare(`UPDATE projects SET last_active_at = ? WHERE id = ?`).run(now, item.projectId);
      return { id };
    } catch (e: unknown) {
      console.error('[memory:saveProjectMemory]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:getProjectMemory', async (_e, projectId: string) =>
    db.prepare(`SELECT * FROM project_memory WHERE project_id = ? ORDER BY blocker_flag DESC, relevance_score DESC, created_at DESC LIMIT 30`)
      .all(projectId)
  );

  // ══════════════════════════════════════════════════════════════════════
  // LAYER 2 — SESSION MEMORY
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:saveSessionMemory', async (_e, session: {
    conversationId: string; summary?: string;
    activeGoals?: string[]; activeTasks?: string[]; activeFiles?: string[];
    emotionalPattern?: string; unresolvedItems?: string[]; projectId?: string;
  }) => {
    try {
      const now = new Date().toISOString();
      const existing = db.prepare('SELECT id FROM session_memory WHERE conversation_id = ?')
        .get(session.conversationId) as { id: string } | undefined;
      if (existing) {
        db.prepare(`
          UPDATE session_memory SET
            summary = COALESCE(?, summary),
            active_goals_json = ?,
            active_tasks_json = ?,
            active_files_json = ?,
            emotional_pattern = COALESCE(?, emotional_pattern),
            unresolved_items_json = ?,
            project_id = COALESCE(?, project_id),
            updated_at = ?
          WHERE conversation_id = ?
        `).run(
          session.summary || null,
          JSON.stringify(session.activeGoals || []),
          JSON.stringify(session.activeTasks || []),
          JSON.stringify(session.activeFiles || []),
          session.emotionalPattern || null,
          JSON.stringify(session.unresolvedItems || []),
          session.projectId || null, now,
          session.conversationId,
        );
        return { id: existing.id, updated: true };
      }
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO session_memory
          (id, conversation_id, summary, active_goals_json, active_tasks_json,
           active_files_json, emotional_pattern, unresolved_items_json, project_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, session.conversationId, session.summary || null,
        JSON.stringify(session.activeGoals || []),
        JSON.stringify(session.activeTasks || []),
        JSON.stringify(session.activeFiles || []),
        session.emotionalPattern || null,
        JSON.stringify(session.unresolvedItems || []),
        session.projectId || null, now, now,
      );
      return { id, created: true };
    } catch (e: unknown) {
      console.error('[memory:saveSessionMemory]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:getSessionMemory', async (_e, conversationId: string) =>
    db.prepare('SELECT * FROM session_memory WHERE conversation_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(conversationId)
  );

  // ══════════════════════════════════════════════════════════════════════
  // LAYER 3 — WORKING MEMORY (DB-backed, single row per user)
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:getWorkingMemory', async (_e, userId = 'default') =>
    db.prepare('SELECT * FROM working_memory WHERE user_id = ?').get(userId)
  );

  ipcMain.handle('memory:updateWorkingMemory', async (_e, updates: {
    userId?: string;
    activeContextSummary?: string;
    activeProjectIds?: string[];
    activeGoalIds?: string[];
    pendingCommitments?: string[];
    relevantFileIds?: string[];
    relevantMemoryIds?: string[];
  }) => {
    try {
      const userId = updates.userId || 'default';
      const now = new Date().toISOString();
      const existing = db.prepare('SELECT id FROM working_memory WHERE user_id = ?').get(userId);
      if (existing) {
        const sets: string[] = ['refreshed_at = ?'];
        const vals: unknown[] = [now];
        if (updates.activeContextSummary !== undefined) { sets.push('active_context_summary = ?'); vals.push(updates.activeContextSummary); }
        if (updates.activeProjectIds)                   { sets.push('active_project_ids_json = ?'); vals.push(JSON.stringify(updates.activeProjectIds)); }
        if (updates.activeGoalIds)                      { sets.push('active_goal_ids_json = ?'); vals.push(JSON.stringify(updates.activeGoalIds)); }
        if (updates.pendingCommitments)                 { sets.push('pending_commitments_json = ?'); vals.push(JSON.stringify(updates.pendingCommitments)); }
        if (updates.relevantFileIds)                    { sets.push('relevant_file_ids_json = ?'); vals.push(JSON.stringify(updates.relevantFileIds)); }
        if (updates.relevantMemoryIds)                  { sets.push('relevant_memory_ids_json = ?'); vals.push(JSON.stringify(updates.relevantMemoryIds)); }
        vals.push(userId);
        db.prepare(`UPDATE working_memory SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals);
      } else {
        db.prepare(`
          INSERT INTO working_memory
            (id, user_id, active_context_summary, active_project_ids_json, active_goal_ids_json,
             pending_commitments_json, relevant_file_ids_json, relevant_memory_ids_json, refreshed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(), userId,
          updates.activeContextSummary || null,
          JSON.stringify(updates.activeProjectIds || []),
          JSON.stringify(updates.activeGoalIds || []),
          JSON.stringify(updates.pendingCommitments || []),
          JSON.stringify(updates.relevantFileIds || []),
          JSON.stringify(updates.relevantMemoryIds || []),
          now,
        );
      }
      return { updated: true };
    } catch (e: unknown) {
      console.error('[memory:updateWorkingMemory]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // GOALS
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:saveGoal', async (_e, goal: {
    title: string; summary?: string;
    priorityScore?: number; emotionalSignificanceScore?: number; strategicSignificanceScore?: number;
  }) => {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO goals (id, title, summary, priority_score, emotional_significance_score, strategic_significance_score, created_at, updated_at, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, goal.title, goal.summary || null,
             goal.priorityScore ?? 0.5, goal.emotionalSignificanceScore ?? 0.5, goal.strategicSignificanceScore ?? 0.5,
             now, now, now);
      return { id };
    } catch (e: unknown) {
      console.error('[memory:saveGoal]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:getGoals', async (_e, opts: { status?: string; limit?: number } = {}) => {
    try {
      let sql = 'SELECT * FROM goals WHERE 1=1';
      const params: (string | number)[] = [];
      if (opts.status) { sql += ' AND status = ?'; params.push(opts.status); }
      else { sql += " AND status = 'active'"; }
      sql += ' ORDER BY priority_score DESC, strategic_significance_score DESC LIMIT ?';
      params.push(opts.limit || 20);
      return db.prepare(sql).all(...params);
    } catch (e: unknown) {
      console.error('[memory:getGoals]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:updateGoal', async (_e, id: string, updates: Record<string, unknown>) => {
    try {
      const allowed = ['title','summary','status','priority_score','emotional_significance_score','strategic_significance_score'];
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const k of allowed) { if (k in updates) { sets.push(`${k} = ?`); vals.push(updates[k]); } }
      if (sets.length === 0) return { updated: false };
      sets.push('updated_at = ?', 'last_active_at = ?');
      const now = new Date().toISOString();
      vals.push(now, now, id);
      db.prepare(`UPDATE goals SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return { updated: true };
    } catch (e: unknown) {
      console.error('[memory:updateGoal]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // COMMITMENTS (Henry's explicit promises)
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:saveCommitment', async (_e, c: {
    description: string; sourceConversationId?: string; projectId?: string;
    dueDate?: string; importanceScore?: number;
  }) => {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO commitments (id, source_conversation_id, project_id, description, importance_score, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, c.sourceConversationId || null, c.projectId || null,
             c.description, c.importanceScore ?? 0.5, now, now);
      return { id };
    } catch (e: unknown) {
      console.error('[memory:saveCommitment]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:getCommitments', async (_e, opts: { status?: string; limit?: number } = {}) => {
    try {
      let sql = 'SELECT * FROM commitments WHERE 1=1';
      const params: (string | number)[] = [];
      if (opts.status) { sql += ' AND status = ?'; params.push(opts.status); }
      else { sql += " AND status IN ('open','in_progress')"; }
      sql += ' ORDER BY importance_score DESC, created_at ASC LIMIT ?';
      params.push(opts.limit || 30);
      return db.prepare(sql).all(...params);
    } catch (e: unknown) {
      console.error('[memory:getCommitments]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:resolveCommitment', async (_e, id: string) => {
    try {
      const now = new Date().toISOString();
      db.prepare(`UPDATE commitments SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`)
        .run(now, now, id);
      return { resolved: true };
    } catch (e: unknown) {
      console.error('[memory:resolveCommitment]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:updateCommitment', async (_e, id: string, updates: Record<string, unknown>) => {
    try {
      const allowed = ['description','status','due_date','importance_score','project_id'];
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const k of allowed) { if (k in updates) { sets.push(`${k} = ?`); vals.push(updates[k]); } }
      if (sets.length === 0) return { updated: false };
      sets.push('updated_at = ?');
      vals.push(new Date().toISOString(), id);
      db.prepare(`UPDATE commitments SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return { updated: true };
    } catch (e: unknown) {
      console.error('[memory:updateCommitment]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // MILESTONES
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:saveMilestone', async (_e, m: {
    title: string; summary?: string; milestoneType?: string;
    projectId?: string; significanceScore?: number;
  }) => {
    try {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO milestones (id, project_id, title, summary, milestone_type, significance_score, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, m.projectId || null, m.title, m.summary || null,
             m.milestoneType || 'win', m.significanceScore ?? 0.7, new Date().toISOString());
      return { id };
    } catch (e: unknown) {
      console.error('[memory:saveMilestone]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:getMilestones', async (_e, opts: { projectId?: string; limit?: number } = {}) => {
    try {
      let sql = 'SELECT * FROM milestones WHERE 1=1';
      const params: (string | number)[] = [];
      if (opts.projectId) { sql += ' AND project_id = ?'; params.push(opts.projectId); }
      sql += ' ORDER BY significance_score DESC, created_at DESC LIMIT ?';
      params.push(opts.limit || 20);
      return db.prepare(sql).all(...params);
    } catch (e: unknown) {
      console.error('[memory:getMilestones]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // LAYER 6 — RELATIONSHIP MEMORY
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:saveRelationshipMemory', async (_e, item: {
    patternType: string; summary: string;
    supportPreference?: string; contextTrigger?: string;
    confidenceScore?: number; relevanceScore?: number;
  }) => {
    try {
      const now = new Date().toISOString();
      // Upsert by pattern_type — merge with existing if confidence is higher
      const existing = db.prepare('SELECT id, confidence_score FROM relationship_memory WHERE pattern_type = ? ORDER BY confidence_score DESC LIMIT 1')
        .get(item.patternType) as { id: string; confidence_score: number } | undefined;
      if (existing && (item.confidenceScore ?? 0.5) < existing.confidence_score) {
        return { id: existing.id, skipped: true };
      }
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO relationship_memory
          (id, pattern_type, summary, support_preference, context_trigger, confidence_score, relevance_score, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, item.patternType, item.summary,
             item.supportPreference || null, item.contextTrigger || null,
             item.confidenceScore ?? 0.5, item.relevanceScore ?? 0.5,
             now, now);
      return { id };
    } catch (e: unknown) {
      console.error('[memory:saveRelationshipMemory]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:getRelationshipMemory', async (_e, opts: { limit?: number } = {}) =>
    db.prepare(`SELECT * FROM relationship_memory ORDER BY confidence_score DESC, relevance_score DESC LIMIT ?`)
      .all(opts.limit || 10)
  );

  // ══════════════════════════════════════════════════════════════════════
  // LAYER 7 — NARRATIVE MEMORY (life/work arcs)
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:saveNarrativeMemory', async (_e, arc: {
    arcName: string; summary: string; startDate?: string; endDate?: string;
    importanceScore?: number; linkedProjectIds?: string[]; linkedMemoryIds?: string[];
  }) => {
    try {
      const now = new Date().toISOString();
      // Update existing arc by name if it exists
      const existing = db.prepare('SELECT id FROM narrative_memory WHERE arc_name = ? AND active_status = 1 LIMIT 1')
        .get(arc.arcName) as { id: string } | undefined;
      if (existing) {
        db.prepare(`UPDATE narrative_memory SET summary = ?, importance_score = COALESCE(?, importance_score), linked_project_ids_json = COALESCE(?, linked_project_ids_json), updated_at = ? WHERE id = ?`)
          .run(arc.summary, arc.importanceScore || null, arc.linkedProjectIds ? JSON.stringify(arc.linkedProjectIds) : null, now, existing.id);
        return { id: existing.id, updated: true };
      }
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO narrative_memory
          (id, arc_name, summary, start_date, end_date, importance_score,
           linked_project_ids_json, linked_memory_ids_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, arc.arcName, arc.summary, arc.startDate || null, arc.endDate || null,
             arc.importanceScore ?? 0.7,
             JSON.stringify(arc.linkedProjectIds || []),
             JSON.stringify(arc.linkedMemoryIds || []),
             now, now);
      return { id, created: true };
    } catch (e: unknown) {
      console.error('[memory:saveNarrativeMemory]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:getNarrativeMemory', async (_e, opts: { activeOnly?: boolean; limit?: number } = {}) => {
    try {
      let sql = 'SELECT * FROM narrative_memory WHERE 1=1';
      const params: (string | number)[] = [];
      if (opts.activeOnly !== false) { sql += ' AND active_status = 1'; }
      sql += ' ORDER BY importance_score DESC, updated_at DESC LIMIT ?';
      params.push(opts.limit || 10);
      return db.prepare(sql).all(...params);
    } catch (e: unknown) {
      console.error('[memory:getNarrativeMemory]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // MEMORY SUMMARIES (daily/weekly/monthly/where-left-off)
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:saveMemorySummary', async (_e, s: {
    summaryType: string; periodLabel?: string; summary: string;
    linkedMemoryIds?: string[]; linkedProjectIds?: string[];
  }) => {
    try {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO memory_summaries
          (id, summary_type, period_label, summary, linked_memory_ids_json, linked_project_ids_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, s.summaryType, s.periodLabel || null, s.summary,
             JSON.stringify(s.linkedMemoryIds || []),
             JSON.stringify(s.linkedProjectIds || []),
             new Date().toISOString());
      return { id };
    } catch (e: unknown) {
      console.error('[memory:saveMemorySummary]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:getMemorySummaries', async (_e, opts: {
    summaryType?: string; limit?: number;
  } = {}) => {
    try {
      let sql = 'SELECT * FROM memory_summaries WHERE 1=1';
      const params: (string | number)[] = [];
      if (opts.summaryType) { sql += ' AND summary_type = ?'; params.push(opts.summaryType); }
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(opts.limit || 10);
      return db.prepare(sql).all(...params);
    } catch (e: unknown) {
      console.error('[memory:getMemorySummaries]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // MEMORY GRAPH EDGES
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:saveGraphEdge', async (_e, edge: {
    fromEntityType: string; fromEntityId: string;
    toEntityType: string; toEntityId: string;
    relationshipType: string; weightScore?: number;
  }) => {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR REPLACE INTO memory_graph_edges
          (id, from_entity_type, from_entity_id, to_entity_type, to_entity_id, relationship_type, weight_score, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, edge.fromEntityType, edge.fromEntityId,
             edge.toEntityType, edge.toEntityId,
             edge.relationshipType, edge.weightScore ?? 0.5, now, now);
      return { id };
    } catch (e: unknown) {
      console.error('[memory:saveGraphEdge]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:getGraphEdges', async (_e, opts: {
    fromEntityId?: string; toEntityId?: string;
    fromEntityType?: string; relationshipType?: string;
  } = {}) => {
    try {
      let sql = 'SELECT * FROM memory_graph_edges WHERE 1=1';
      const params: string[] = [];
      if (opts.fromEntityId)    { sql += ' AND from_entity_id = ?';    params.push(opts.fromEntityId); }
      if (opts.toEntityId)      { sql += ' AND to_entity_id = ?';      params.push(opts.toEntityId); }
      if (opts.fromEntityType)  { sql += ' AND from_entity_type = ?';  params.push(opts.fromEntityType); }
      if (opts.relationshipType){ sql += ' AND relationship_type = ?'; params.push(opts.relationshipType); }
      sql += ' ORDER BY weight_score DESC LIMIT 50';
      return db.prepare(sql).all(...params);
    } catch (e: unknown) {
      console.error('[memory:getGraphEdges]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // BANDWIDTH-AWARE DEEP CONTEXT BUILDER
  // ══════════════════════════════════════════════════════════════════════
  // Modes: shallow | normal | deep | maximum
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:buildContext', async (_e, params: {
    conversationId?: string;
    query?: string;
    maxFactsFetch?: number;
    bandwidth?: 'shallow' | 'normal' | 'deep' | 'maximum';
  }) => {
    try {
      const bandwidth = params.bandwidth || 'normal';
      return buildDeepContext(params.conversationId, params.query || '', params.maxFactsFetch, bandwidth);
    } catch (e: unknown) {
      console.error('[memory:buildContext]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:buildDeepContext', async (_e, params: {
    conversationId?: string;
    query?: string;
    bandwidth?: 'shallow' | 'normal' | 'deep' | 'maximum';
  }) => {
    try {
      return buildDeepContext(params.conversationId, params.query || '', undefined, params.bandwidth || 'maximum');
    } catch (e: unknown) {
      console.error('[memory:buildDeepContext]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // WHERE WE LEFT OFF — startup recovery summary
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:getWhereWeLeftOff', async () => {
    try {
      return buildWhereWeLeftOff();
    } catch (e: unknown) {
      console.error('[memory:getWhereWeLeftOff]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  ipcMain.handle('memory:saveWhereWeLeftOff', async (_e, summary: string) => {
    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      // Keep only last 3 where-we-left-off entries
      const old = db.prepare(`SELECT id FROM memory_summaries WHERE summary_type = 'where_we_left_off' ORDER BY created_at DESC LIMIT -1 OFFSET 3`).all() as { id: string }[];
      for (const o of old) db.prepare('DELETE FROM memory_summaries WHERE id = ?').run(o.id);
      db.prepare(`INSERT INTO memory_summaries (id, summary_type, period_label, summary, created_at) VALUES (?, 'where_we_left_off', ?, ?, ?)`)
        .run(id, new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), summary, now);
      return { id };
    } catch (e: unknown) {
      console.error('[memory:saveWhereWeLeftOff]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // COMPRESSION — session end handler
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('memory:compressSession', async (_e, opts: {
    conversationId: string;
    summary: string;
    unresolvedItems?: string[];
    emotionalPattern?: string;
  }) => {
    try {
      const now = new Date().toISOString();
      // Save session end summary
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO memory_summaries (id, summary_type, period_label, summary, created_at)
        VALUES (?, 'session_end', ?, ?, ?)
      `).run(id, `Session ${opts.conversationId.slice(0, 8)}`, opts.summary, now);

      // Update session memory with final state
      if (opts.unresolvedItems || opts.emotionalPattern) {
        db.prepare(`
          UPDATE session_memory SET
            summary = COALESCE(?, summary),
            unresolved_items_json = COALESCE(?, unresolved_items_json),
            emotional_pattern = COALESCE(?, emotional_pattern),
            updated_at = ?
          WHERE conversation_id = ?
        `).run(opts.summary, opts.unresolvedItems ? JSON.stringify(opts.unresolvedItems) : null,
               opts.emotionalPattern || null, now, opts.conversationId);
      }

      return { compressed: true, summaryId: id };
    } catch (e: unknown) {
      console.error('[memory:compressSession]', e instanceof Error ? e.message : String(e));
      return null as any;
    }
  });
}

// ── Bandwidth-aware context builder ───────────────────────────────────────────

function buildDeepContext(
  conversationId: string | undefined,
  query: string,
  maxFactsFetch?: number,
  bandwidth: 'shallow' | 'normal' | 'deep' | 'maximum' = 'normal',
) {
  const factFetchCap = Math.min(Math.max(maxFactsFetch ?? 40, 10), 80);

  // ── Layer 1+2: Facts + Conversation Summary (all modes) ──────────────
  type FactRow = { fact: string; category: string; importance?: number; created_at?: string };
  let factRows: FactRow[] = [];

  if (bandwidth === 'shallow') {
    factRows = db.prepare(`SELECT fact, category, importance, created_at FROM memory_facts ORDER BY importance DESC, created_at DESC LIMIT 15`).all() as FactRow[];
  } else if (conversationId) {
    factRows = db.prepare(`
      SELECT fact, category, importance, created_at FROM memory_facts
      WHERE conversation_id IS NULL OR conversation_id = ?
      ORDER BY CASE WHEN conversation_id = ? THEN 0 ELSE 1 END, importance DESC, created_at DESC
      LIMIT ?
    `).all(conversationId, conversationId, factFetchCap) as FactRow[];
  } else {
    factRows = db.prepare(`SELECT fact, category, importance, created_at FROM memory_facts ORDER BY importance DESC, created_at DESC LIMIT ?`).all(factFetchCap) as FactRow[];
  }

  const facts: HenryLeanMemoryParts['facts'] = factRows.map((r) => ({
    fact: r.fact,
    category: r.category || 'general',
    importance: r.importance,
    created_at: r.created_at,
  }));

  let conversationSummary: string | null = null;
  if (conversationId) {
    const row = db.prepare(`SELECT summary FROM conversation_summaries WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`).get(conversationId) as { summary: string } | undefined;
    conversationSummary = row?.summary ?? null;
  }

  // Workspace hints
  let workspaceHints: Array<{ file_path: string; summary: string }> = [];
  if (query && bandwidth !== 'shallow') {
    const like = `%${query}%`;
    const files = db.prepare(`SELECT file_path, summary FROM workspace_index WHERE file_path LIKE ? OR summary LIKE ? ORDER BY last_indexed DESC LIMIT 5`).all(like, like) as { file_path: string; summary: string }[];
    workspaceHints = files.slice(0, 3).map((f) => ({ file_path: f.file_path, summary: f.summary || '' }));
  }

  const lean: HenryLeanMemoryParts = { conversationSummary, facts, workspaceHints };

  // ── Shallow stops here ───────────────────────────────────────────────
  if (bandwidth === 'shallow') {
    return { lean, bandwidth, estimatedTokens: Math.ceil(JSON.stringify(lean).length / 4), factCount: facts.length };
  }

  // ── Normal+: Working memory + personal memory ────────────────────────
  const workingMemory = db.prepare(`SELECT * FROM working_memory WHERE user_id = 'default' LIMIT 1`).get() as any;
  const personalMemory = db.prepare(`
    SELECT memory_key, memory_value, memory_type, confidence_score, emotional_significance_score,
           strategic_significance_score, created_at
    FROM personal_memory WHERE active_status = 1
    ORDER BY strategic_significance_score DESC, emotional_significance_score DESC
    LIMIT 30
  `).all() as any[];

  const openCommitments = db.prepare(`
    SELECT description, importance_score, created_at FROM commitments
    WHERE status IN ('open','in_progress') ORDER BY importance_score DESC LIMIT 15
  `).all() as any[];

  const activeGoals = db.prepare(`
    SELECT title, summary, priority_score FROM goals
    WHERE status = 'active' ORDER BY priority_score DESC LIMIT 10
  `).all() as any[];

  // ── Deep+: Projects, relationship memory, narrative ──────────────────
  let activeProjects: any[] = [];
  let relationshipMemory: any[] = [];
  let narrativeMemory: any[] = [];

  if (bandwidth === 'deep' || bandwidth === 'maximum') {
    activeProjects = db.prepare(`SELECT name, summary, strategic_importance_score, last_active_at FROM projects WHERE status = 'active' ORDER BY strategic_importance_score DESC, last_active_at DESC LIMIT 5`).all() as any[];
    relationshipMemory = db.prepare(`SELECT pattern_type, summary, support_preference FROM relationship_memory ORDER BY confidence_score DESC LIMIT 5`).all() as any[];
    narrativeMemory = db.prepare(`SELECT arc_name, summary, importance_score FROM narrative_memory WHERE active_status = 1 ORDER BY importance_score DESC LIMIT 5`).all() as any[];
  }

  // ── Maximum: Milestones + recent sessions + where-we-left-off ────────
  let recentMilestones: any[] = [];
  let whereWeLeftOff: string | null = null;
  let recentSessions: any[] = [];

  if (bandwidth === 'maximum') {
    recentMilestones = db.prepare(`SELECT title, summary, milestone_type, significance_score, created_at FROM milestones ORDER BY significance_score DESC, created_at DESC LIMIT 5`).all() as any[];
    const wlo = db.prepare(`SELECT summary FROM memory_summaries WHERE summary_type = 'where_we_left_off' ORDER BY created_at DESC LIMIT 1`).get() as { summary: string } | undefined;
    whereWeLeftOff = wlo?.summary ?? null;
    recentSessions = db.prepare(`SELECT summary, emotional_pattern, created_at FROM memory_summaries WHERE summary_type = 'session_end' ORDER BY created_at DESC LIMIT 3`).all() as any[];
  }

  const extended = {
    workingMemory: workingMemory || null,
    personalMemory,
    openCommitments,
    activeGoals,
    activeProjects,
    relationshipMemory,
    narrativeMemory,
    recentMilestones,
    whereWeLeftOff,
    recentSessions,
  };

  const estimatedTokens = Math.ceil(JSON.stringify({ lean, extended }).length / 4);

  return {
    lean,
    extended,
    bandwidth,
    estimatedTokens,
    factCount: facts.length,
  };
}

// ── Where-we-left-off recovery builder ───────────────────────────────────────

function buildWhereWeLeftOff(): {
  lastProject: string | null;
  openCommitments: { description: string; importance_score: number }[];
  activeGoals: { title: string; priority_score: number }[];
  recentSession: { summary: string; emotional_pattern: string | null } | null;
  lastWhereWeLeftOff: string | null;
  recentMilestone: { title: string; milestone_type: string } | null;
} {
  const lastProject = db.prepare(`SELECT name FROM projects WHERE status = 'active' ORDER BY last_active_at DESC LIMIT 1`).get() as { name: string } | undefined;
  const openCommitments = db.prepare(`SELECT description, importance_score FROM commitments WHERE status IN ('open','in_progress') ORDER BY importance_score DESC LIMIT 5`).all() as { description: string; importance_score: number }[];
  const activeGoals = db.prepare(`SELECT title, priority_score FROM goals WHERE status = 'active' ORDER BY priority_score DESC LIMIT 3`).all() as { title: string; priority_score: number }[];
  const recentSession = db.prepare(`SELECT summary, emotional_pattern FROM memory_summaries WHERE summary_type = 'session_end' ORDER BY created_at DESC LIMIT 1`).get() as { summary: string; emotional_pattern: string | null } | undefined;
  const wlo = db.prepare(`SELECT summary FROM memory_summaries WHERE summary_type = 'where_we_left_off' ORDER BY created_at DESC LIMIT 1`).get() as { summary: string } | undefined;
  const recentMilestone = db.prepare(`SELECT title, milestone_type FROM milestones ORDER BY created_at DESC LIMIT 1`).get() as { title: string; milestone_type: string } | undefined;

  return {
    lastProject: lastProject?.name ?? null,
    openCommitments,
    activeGoals,
    recentSession: recentSession ?? null,
    lastWhereWeLeftOff: wlo?.summary ?? null,
    recentMilestone: recentMilestone ?? null,
  };
}

// ── Fact extraction utility ───────────────────────────────────────────────────

export function extractFactsFromMessage(content: string): string[] {
  const facts: string[] = [];
  const patterns = [
    /(?:my name is|i'm called|call me)\s+(\w+)/gi,
    /(?:i work (?:at|for|with))\s+(.+?)(?:\.|,|$)/gi,
    /(?:the (?:project|company|team) is)\s+(.+?)(?:\.|,|$)/gi,
    /(?:(?:use|using|prefer|want)\s+)(\w+(?:\s+\w+)?)\s+(?:for|as|to)/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) facts.push(match[0].trim());
  }
  return facts;
}
