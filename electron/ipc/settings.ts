/**
 * Settings — Handles all settings, provider, conversation, message, and cost CRUD.
 *
 * IPC channels match what preload.ts exposes to the renderer:
 *   settings:getAll, settings:save, providers:getAll, providers:save,
 *   conversations:getAll, conversations:create, conversations:update,
 *   conversations:delete, messages:getAll, messages:save,
 *   cost:getAll
 */

import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';

export function registerSettingsHandlers(db: Database.Database) {
  // ── Settings ────────────────────────────────────────────────

  // Returns a Record<string, string>
  ipcMain.handle('settings:getAll', () => {
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;
    const settings: Record<string, string> = {};
    rows.forEach((row) => {
      settings[row.key] = row.value;
    });
    return settings;
  });

  // preload sends { key, value }
  ipcMain.handle('settings:save', (_, data: { key: string; value: string }) => {
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(data.key, data.value);
    return true;
  });

  // ── Providers ───────────────────────────────────────────────

  ipcMain.handle('providers:getAll', () => {
    return db.prepare('SELECT * FROM providers ORDER BY name').all();
  });

  ipcMain.handle(
    'providers:save',
    (
      _,
      provider: {
        id: string;
        name: string;
        apiKey: string;
        enabled: boolean;
        models: string;
      }
    ) => {
      db.prepare(
        `INSERT INTO providers (id, name, api_key, enabled, models, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         api_key = excluded.api_key,
         enabled = excluded.enabled,
         models = excluded.models,
         updated_at = datetime('now')`
      ).run(
        provider.id,
        provider.name,
        provider.apiKey,
        provider.enabled ? 1 : 0,
        provider.models
      );
      return true;
    }
  );

  ipcMain.handle('providers:delete', (_, id: string) => {
    db.prepare('DELETE FROM providers WHERE id = ?').run(id);
    return true;
  });

  // ── Conversations ───────────────────────────────────────────

  ipcMain.handle('conversations:getAll', () => {
    return db
      .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
      .all();
  });

  ipcMain.handle('conversations:create', (_, title: string) => {
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO conversations (id, title) VALUES (?, ?)'
    ).run(id, title);
    return { id, title, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  });

  ipcMain.handle('conversations:update', (_, data: { id: string; title: string }) => {
    db.prepare(
      "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(data.title, data.id);
    return true;
  });

  ipcMain.handle('conversations:delete', (_, id: string) => {
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    return true;
  });

  // ── Messages ────────────────────────────────────────────────

  ipcMain.handle('messages:getAll', (_, conversationId: string) => {
    return db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
      )
      .all(conversationId);
  });

  ipcMain.handle(
    'messages:save',
    (
      _,
      message: {
        id: string;
        conversation_id: string;
        role: string;
        content: string;
        model?: string;
        provider?: string;
        tokens_used?: number;
        cost?: number;
        engine?: string;
      }
    ) => {
      db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, model, provider, tokens_used, cost, engine)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        message.id,
        message.conversation_id,
        message.role,
        message.content,
        message.model || null,
        message.provider || null,
        message.tokens_used || 0,
        message.cost || 0,
        message.engine || null
      );

      // Update conversation timestamp
      db.prepare(
        "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?"
      ).run(message.conversation_id);

      // Log cost if applicable
      if (message.cost && message.cost > 0) {
        db.prepare(
          `INSERT INTO cost_log (provider, model, tokens_input, tokens_output, cost, conversation_id)
         VALUES (?, ?, 0, ?, ?, ?)`
        ).run(
          message.provider || '',
          message.model || '',
          message.tokens_used || 0,
          message.cost,
          message.conversation_id
        );
      }

      return true;
    }
  );

  // ── Cost Tracking ───────────────────────────────────────────

  ipcMain.handle('cost:getAll', (_, period?: string) => {
    let query = 'SELECT * FROM cost_log';

    if (period === '7d') {
      query += " WHERE created_at > datetime('now', '-7 days')";
    } else if (period === '30d') {
      query += " WHERE created_at > datetime('now', '-30 days')";
    }

    query += ' ORDER BY created_at DESC';
    return db.prepare(query).all();
  });
}
