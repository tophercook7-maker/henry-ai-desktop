import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database;

export function initDatabase(dataDir: string): Database.Database {
  const dbPath = path.join(dataDir, 'henry.db');
  db = new Database(dbPath);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    -- Settings (key-value store)
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- AI Providers
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      models TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Conversations
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Messages
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      model TEXT,
      provider TEXT,
      tokens_used INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      engine TEXT CHECK(engine IN ('companion', 'worker', NULL)),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    -- Task Queue
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled')),
      priority INTEGER NOT NULL DEFAULT 5,
      payload TEXT DEFAULT '{}',
      result TEXT,
      error TEXT,
      engine TEXT DEFAULT 'worker',
      source_engine TEXT,
      conversation_id TEXT,
      cost REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    );

    -- Cost Tracking
    CREATE TABLE IF NOT EXISTS cost_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      conversation_id TEXT,
      task_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Memory Facts
    CREATE TABLE IF NOT EXISTS memory_facts (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      fact TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      importance INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    -- Conversation Summaries
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      message_count INTEGER DEFAULT 0,
      token_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    -- Workspace File Index
    CREATE TABLE IF NOT EXISTS workspace_index (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      file_type TEXT,
      summary TEXT,
      last_indexed TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0
    );

    -- Local scripture text (imported JSON / bundles)
    CREATE TABLE IF NOT EXISTS scripture_entries (
      id TEXT PRIMARY KEY,
      normalized_reference TEXT NOT NULL UNIQUE,
      reference TEXT NOT NULL,
      book TEXT NOT NULL,
      book_slug TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse_start INTEGER NOT NULL,
      verse_end INTEGER NOT NULL,
      text TEXT NOT NULL,
      source_profile_id TEXT,
      source_label TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    -- Initialize default settings if empty
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('setup_complete', 'false'),
      ('theme', 'dark'),
      ('companion_model', ''),
      ('companion_provider', ''),
      ('worker_model', ''),
      ('worker_provider', ''),
      ('default_temperature', '0.7'),
      ('workspace_path', '');
  `);

  migrateDatabaseSchema(db);

  return db;
}

/** Additive columns for task → workspace bridge (idempotent). */
function migrateDatabaseSchema(db: Database.Database) {
  const cols = db.prepare(`PRAGMA table_info(tasks)`).all() as { name: string }[];
  const has = (n: string) => cols.some((c) => c.name === n);
  try {
    if (!has('created_from_mode')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN created_from_mode TEXT`);
    }
    if (!has('related_file_path')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN related_file_path TEXT`);
    }
    if (!has('created_from_message_id')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN created_from_message_id TEXT`);
    }
  } catch {
    /* ignore migration errors on unusual DB states */
  }

  // Memory Blueprint — full 7-layer schema migration
  migrateMemoryBlueprintSchema(db);
}

/**
 * Idempotent migration for the full Henry Memory Blueprint schema.
 * Adds all Layer 3–7 tables without touching existing tables.
 */
function migrateMemoryBlueprintSchema(db: Database.Database) {
  db.exec(`
    -- ── Layer 4: Personal Memory ─────────────────────────────────────
    -- Enhanced facts with full scoring. Replaces memory_facts for new saves.
    CREATE TABLE IF NOT EXISTS personal_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      memory_key TEXT NOT NULL,
      memory_value TEXT NOT NULL,
      memory_type TEXT NOT NULL DEFAULT 'general',
      summary TEXT,
      source TEXT,
      confidence_score REAL DEFAULT 0.7,
      relevance_score REAL DEFAULT 0.5,
      emotional_significance_score REAL DEFAULT 0.3,
      strategic_significance_score REAL DEFAULT 0.5,
      recency_score REAL DEFAULT 1.0,
      active_status INTEGER NOT NULL DEFAULT 1,
      tags_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_recalled_at TEXT
    );

    -- ── Layer 5: Projects ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      type TEXT DEFAULT 'general',
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'paused', 'completed', 'archived')),
      summary TEXT,
      strategic_importance_score REAL DEFAULT 0.5,
      emotional_importance_score REAL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_memory (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      memory_key TEXT NOT NULL,
      memory_value TEXT NOT NULL,
      summary TEXT,
      blocker_flag INTEGER NOT NULL DEFAULT 0,
      deadline TEXT,
      confidence_score REAL DEFAULT 0.8,
      relevance_score REAL DEFAULT 0.7,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_recalled_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- ── Layer 2: Session Memory ──────────────────────────────────────
    CREATE TABLE IF NOT EXISTS session_memory (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      summary TEXT,
      active_goals_json TEXT DEFAULT '[]',
      active_tasks_json TEXT DEFAULT '[]',
      active_files_json TEXT DEFAULT '[]',
      emotional_pattern TEXT,
      unresolved_items_json TEXT DEFAULT '[]',
      project_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    -- ── Layer 3: Working Memory (DB-backed, one row per user) ────────
    CREATE TABLE IF NOT EXISTS working_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE DEFAULT 'default',
      active_context_summary TEXT,
      active_project_ids_json TEXT DEFAULT '[]',
      active_goal_ids_json TEXT DEFAULT '[]',
      pending_commitments_json TEXT DEFAULT '[]',
      relevant_file_ids_json TEXT DEFAULT '[]',
      relevant_memory_ids_json TEXT DEFAULT '[]',
      refreshed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Goals ────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'paused', 'completed', 'abandoned')),
      priority_score REAL DEFAULT 0.5,
      emotional_significance_score REAL DEFAULT 0.5,
      strategic_significance_score REAL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_active_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Commitments (Henry's explicit promises) ──────────────────────
    CREATE TABLE IF NOT EXISTS commitments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      source_conversation_id TEXT,
      project_id TEXT,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open', 'in_progress', 'completed', 'dropped')),
      due_date TEXT,
      importance_score REAL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    -- ── Milestones ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      project_id TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      milestone_type TEXT NOT NULL DEFAULT 'win'
        CHECK(milestone_type IN ('win','setback','launch','decision','realization','breakthrough','other')),
      significance_score REAL DEFAULT 0.7,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    -- ── Layer 6: Relationship Memory ─────────────────────────────────
    CREATE TABLE IF NOT EXISTS relationship_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      pattern_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      support_preference TEXT,
      context_trigger TEXT,
      confidence_score REAL DEFAULT 0.5,
      relevance_score REAL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_recalled_at TEXT
    );

    -- ── Layer 7: Narrative Memory (life/work arcs) ───────────────────
    CREATE TABLE IF NOT EXISTS narrative_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      arc_name TEXT NOT NULL,
      summary TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      importance_score REAL DEFAULT 0.7,
      active_status INTEGER NOT NULL DEFAULT 1,
      linked_project_ids_json TEXT DEFAULT '[]',
      linked_memory_ids_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Memory Summaries (daily/weekly/monthly/where-left-off) ───────
    CREATE TABLE IF NOT EXISTS memory_summaries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      summary_type TEXT NOT NULL
        CHECK(summary_type IN (
          'daily_rollup','weekly_rollup','monthly_rollup',
          'project_rollup','where_we_left_off','life_timeline_rollup','session_end'
        )),
      period_label TEXT,
      summary TEXT NOT NULL,
      linked_memory_ids_json TEXT DEFAULT '[]',
      linked_project_ids_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Memory Graph Edges (relationship graph) ───────────────────────
    CREATE TABLE IF NOT EXISTS memory_graph_edges (
      id TEXT PRIMARY KEY,
      from_entity_type TEXT NOT NULL,
      from_entity_id TEXT NOT NULL,
      to_entity_type TEXT NOT NULL,
      to_entity_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      weight_score REAL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Indexes for retrieval performance ─────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_personal_memory_type
      ON personal_memory(memory_type, active_status);
    CREATE INDEX IF NOT EXISTS idx_personal_memory_user
      ON personal_memory(user_id, active_status);
    CREATE INDEX IF NOT EXISTS idx_project_memory_project
      ON project_memory(project_id);
    CREATE INDEX IF NOT EXISTS idx_session_memory_conv
      ON session_memory(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_commitments_status
      ON commitments(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_narrative_memory_active
      ON narrative_memory(user_id, active_status);
    CREATE INDEX IF NOT EXISTS idx_memory_graph_from
      ON memory_graph_edges(from_entity_type, from_entity_id);
    CREATE INDEX IF NOT EXISTS idx_memory_graph_to
      ON memory_graph_edges(to_entity_type, to_entity_id);
    CREATE INDEX IF NOT EXISTS idx_memory_summaries_type
      ON memory_summaries(user_id, summary_type, created_at);
  `);
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}
