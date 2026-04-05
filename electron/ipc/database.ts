import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database;

export function initDatabase(dataDir: string) {
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
      engine TEXT DEFAULT 'worker',
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

  return db;
}

export function getDb(): Database.Database {
  return db;
}
