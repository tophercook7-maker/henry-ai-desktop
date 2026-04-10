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
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}
