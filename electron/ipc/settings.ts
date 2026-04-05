import { ipcMain } from 'electron';
import { getDb } from './database';

export function registerSettingsHandlers() {
  const db = getDb();

  // Get all settings
  ipcMain.handle('settings-get', () => {
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

  // Save a setting
  ipcMain.handle('settings-save', (_, key: string, value: string) => {
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(key, value);
    return true;
  });

  // Get all providers
  ipcMain.handle('settings-get-providers', () => {
    return db.prepare('SELECT * FROM providers ORDER BY name').all();
  });

  // Save/update a provider
  ipcMain.handle(
    'settings-save-provider',
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

  // Delete a provider
  ipcMain.handle('settings-delete-provider', (_, id: string) => {
    db.prepare('DELETE FROM providers WHERE id = ?').run(id);
    return true;
  });

  // Conversations
  ipcMain.handle('conversations-list', () => {
    return db
      .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
      .all();
  });

  ipcMain.handle('conversation-get', (_, id: string) => {
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  });

  ipcMain.handle('conversation-create', (_, title: string) => {
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO conversations (id, title) VALUES (?, ?)'
    ).run(id, title);
    return { id, title };
  });

  ipcMain.handle('conversation-delete', (_, id: string) => {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    return true;
  });

  // Messages
  ipcMain.handle('messages-get', (_, conversationId: string) => {
    return db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
      )
      .all(conversationId);
  });

  ipcMain.handle(
    'message-save',
    (
      _,
      message: {
        id: string;
        conversationId: string;
        role: string;
        content: string;
        model?: string;
        provider?: string;
        tokensUsed?: number;
        cost?: number;
        engine?: string;
      }
    ) => {
      db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, model, provider, tokens_used, cost, engine)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        message.id,
        message.conversationId,
        message.role,
        message.content,
        message.model || null,
        message.provider || null,
        message.tokensUsed || 0,
        message.cost || 0,
        message.engine || null
      );

      // Update conversation timestamp
      db.prepare(
        "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?"
      ).run(message.conversationId);

      // Log cost if applicable
      if (message.cost && message.cost > 0) {
        db.prepare(
          `INSERT INTO cost_log (provider, model, tokens_output, cost, conversation_id)
         VALUES (?, ?, ?, ?, ?)`
        ).run(
          message.provider || '',
          message.model || '',
          message.tokensUsed || 0,
          message.cost,
          message.conversationId
        );
      }

      return true;
    }
  );

  // Tasks
  ipcMain.handle('tasks-list', () => {
    return db.prepare('SELECT * FROM tasks ORDER BY priority DESC, created_at ASC').all();
  });

  ipcMain.handle(
    'task-create',
    (
      _,
      task: {
        id: string;
        type: string;
        description: string;
        priority: number;
        payload: string;
      }
    ) => {
      db.prepare(
        'INSERT INTO tasks (id, type, description, priority, payload) VALUES (?, ?, ?, ?, ?)'
      ).run(task.id, task.type, task.description, task.priority, task.payload);
      return true;
    }
  );

  ipcMain.handle(
    'task-update',
    (_, id: string, status: string, result?: string) => {
      const updates: string[] = ['status = ?'];
      const params: any[] = [status];

      if (status === 'running') {
        updates.push("started_at = datetime('now')");
      }
      if (status === 'completed' || status === 'failed') {
        updates.push("completed_at = datetime('now')");
      }
      if (result !== undefined) {
        updates.push('result = ?');
        params.push(result);
      }

      params.push(id);
      db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(
        ...params
      );
      return true;
    }
  );
}
