/**
 * Task Broker — The brain of the dual-engine architecture.
 * 
 * Manages the queue between Companion and Worker engines.
 * The Companion can submit tasks, the Worker picks them up.
 * Both engines can check status independently.
 */

import { ipcMain, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';

interface TaskExecution {
  taskId: string;
  abortController?: AbortController;
}

let db: Database.Database;
let activeExecutions: Map<string, TaskExecution> = new Map();
let mainWindow: BrowserWindow | null = null;

export function registerTaskBrokerHandlers(database: Database.Database, win: BrowserWindow) {
  db = database;
  mainWindow = win;

  // Submit a new task to the queue
  ipcMain.handle('task:submit', async (_event, task: {
    description: string;
    type: string;
    priority?: number;
    payload?: string;
    sourceEngine?: string;
    conversationId?: string;
  }) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO tasks (id, description, type, status, priority, payload, source_engine, conversation_id, created_at)
      VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)
    `).run(
      id,
      task.description,
      task.type,
      task.priority || 1,
      task.payload || null,
      task.sourceEngine || 'companion',
      task.conversationId || null,
      now
    );

    // Notify renderer about new task
    mainWindow?.webContents.send('task:update', {
      id,
      status: 'queued',
      description: task.description,
      type: task.type,
    });

    // Auto-process queue
    processNextTask();

    return { id, status: 'queued' };
  });

  // Get task status
  ipcMain.handle('task:status', async (_event, taskId: string) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return task || null;
  });

  // Get all tasks with optional filter
  ipcMain.handle('task:list', async (_event, filter?: {
    status?: string;
    limit?: number;
  }) => {
    let query = 'SELECT * FROM tasks';
    const params: any[] = [];

    if (filter?.status) {
      query += ' WHERE status = ?';
      params.push(filter.status);
    }

    query += ' ORDER BY priority DESC, created_at ASC';

    if (filter?.limit) {
      query += ' LIMIT ?';
      params.push(filter.limit);
    }

    return db.prepare(query).all(...params);
  });

  // Cancel a task
  ipcMain.handle('task:cancel', async (_event, taskId: string) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!task) return { error: 'Task not found' };

    if (task.status === 'running') {
      // Abort active execution
      const execution = activeExecutions.get(taskId);
      if (execution?.abortController) {
        execution.abortController.abort();
      }
    }

    db.prepare(`
      UPDATE tasks SET status = 'cancelled', completed_at = ? WHERE id = ?
    `).run(new Date().toISOString(), taskId);

    mainWindow?.webContents.send('task:update', { id: taskId, status: 'cancelled' });

    return { id: taskId, status: 'cancelled' };
  });

  // Retry a failed task
  ipcMain.handle('task:retry', async (_event, taskId: string) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!task || (task.status !== 'failed' && task.status !== 'cancelled')) {
      return { error: 'Can only retry failed or cancelled tasks' };
    }

    db.prepare(`
      UPDATE tasks SET status = 'queued', started_at = NULL, completed_at = NULL, result = NULL, error = NULL
      WHERE id = ?
    `).run(taskId);

    mainWindow?.webContents.send('task:update', { id: taskId, status: 'queued' });

    processNextTask();

    return { id: taskId, status: 'queued' };
  });

  // Get queue statistics
  ipcMain.handle('task:stats', async () => {
    const stats = db.prepare(`
      SELECT 
        status,
        COUNT(*) as count
      FROM tasks 
      GROUP BY status
    `).all();

    const totalCost = db.prepare(`
      SELECT COALESCE(SUM(cost), 0) as total FROM tasks WHERE cost > 0
    `).get() as any;

    return {
      byStatus: stats,
      totalCost: totalCost?.total || 0,
      activeCount: activeExecutions.size,
    };
  });
}

// Process the next queued task
async function processNextTask() {
  // Don't run more than 1 worker task at a time (for now)
  if (activeExecutions.size >= 1) return;

  const nextTask = db.prepare(`
    SELECT * FROM tasks WHERE status = 'queued' 
    ORDER BY priority DESC, created_at ASC 
    LIMIT 1
  `).get() as any;

  if (!nextTask) return;

  // Mark as running
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE tasks SET status = 'running', started_at = ? WHERE id = ?
  `).run(now, nextTask.id);

  mainWindow?.webContents.send('task:update', {
    id: nextTask.id,
    status: 'running',
    description: nextTask.description,
  });

  // Also update the worker status in renderer
  mainWindow?.webContents.send('engine:status', {
    engine: 'worker',
    status: 'working',
    taskId: nextTask.id,
    taskDescription: nextTask.description,
  });

  const abortController = new AbortController();
  activeExecutions.set(nextTask.id, {
    taskId: nextTask.id,
    abortController,
  });

  try {
    // Execute the task based on type
    const result = await executeTask(nextTask, abortController.signal);

    // Mark as completed
    db.prepare(`
      UPDATE tasks SET status = 'completed', completed_at = ?, result = ?
      WHERE id = ?
    `).run(new Date().toISOString(), JSON.stringify(result), nextTask.id);

    mainWindow?.webContents.send('task:update', {
      id: nextTask.id,
      status: 'completed',
      result,
    });

    // Send result back to conversation if there is one
    if (nextTask.conversation_id) {
      mainWindow?.webContents.send('task:result', {
        taskId: nextTask.id,
        conversationId: nextTask.conversation_id,
        result,
      });
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // Task was cancelled
      return;
    }

    db.prepare(`
      UPDATE tasks SET status = 'failed', completed_at = ?, error = ?
      WHERE id = ?
    `).run(new Date().toISOString(), error.message, nextTask.id);

    mainWindow?.webContents.send('task:update', {
      id: nextTask.id,
      status: 'failed',
      error: error.message,
    });
  } finally {
    activeExecutions.delete(nextTask.id);

    mainWindow?.webContents.send('engine:status', {
      engine: 'worker',
      status: 'idle',
    });

    // Process next task in queue
    processNextTask();
  }
}

// Execute a task based on its type
async function executeTask(task: any, signal: AbortSignal): Promise<any> {
  const payload = task.payload ? JSON.parse(task.payload) : {};

  switch (task.type) {
    case 'ai_generate':
      return await executeAITask(task, payload, signal);

    case 'file_operation':
      return await executeFileTask(task, payload, signal);

    case 'code_generate':
      return await executeCodeGenTask(task, payload, signal);

    case 'research':
      return await executeResearchTask(task, payload, signal);

    default:
      // Default: treat as AI generation task
      return await executeAITask(task, payload, signal);
  }
}

// AI generation task
async function executeAITask(task: any, payload: any, signal: AbortSignal): Promise<any> {
  // Get worker engine config from settings
  const workerProvider = db.prepare("SELECT value FROM settings WHERE key = 'worker_provider'").get() as any;
  const workerModel = db.prepare("SELECT value FROM settings WHERE key = 'worker_model'").get() as any;
  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(workerProvider?.value) as any;

  if (!provider || !workerModel) {
    throw new Error('Worker engine not configured. Set up a Worker model in Settings.');
  }

  // Build the prompt
  const messages = [
    {
      role: 'system',
      content: `You are Henry AI Worker engine. You handle complex, resource-intensive tasks with thorough, detailed output. The user has delegated this task to you for deep work. Be comprehensive.`,
    },
    {
      role: 'user',
      content: payload.prompt || task.description,
    },
  ];

  // Make AI call (non-streaming for background tasks)
  const { callAI } = require('./ai');
  const result = await callAI({
    provider: workerProvider.value,
    model: workerModel.value,
    apiKey: provider.api_key,
    messages,
    temperature: 0.7,
    signal,
  });

  return {
    type: 'ai_response',
    content: result.content,
    model: workerModel.value,
    tokens: result.usage,
    cost: result.cost,
  };
}

// File operation task
async function executeFileTask(task: any, payload: any, signal: AbortSignal): Promise<any> {
  const fs = require('fs').promises;
  const path = require('path');

  switch (payload.operation) {
    case 'read':
      const content = await fs.readFile(payload.path, 'utf-8');
      return { type: 'file_content', path: payload.path, content };

    case 'write':
      await fs.mkdir(path.dirname(payload.path), { recursive: true });
      await fs.writeFile(payload.path, payload.content, 'utf-8');
      return { type: 'file_written', path: payload.path };

    case 'list':
      const entries = await fs.readdir(payload.path, { withFileTypes: true });
      return {
        type: 'file_list',
        path: payload.path,
        entries: entries.map((e: any) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
        })),
      };

    default:
      throw new Error(`Unknown file operation: ${payload.operation}`);
  }
}

// Code generation task
async function executeCodeGenTask(task: any, payload: any, signal: AbortSignal): Promise<any> {
  // Use AI with code-specific system prompt
  const workerProvider = db.prepare("SELECT value FROM settings WHERE key = 'worker_provider'").get() as any;
  const workerModel = db.prepare("SELECT value FROM settings WHERE key = 'worker_model'").get() as any;
  const provider = db.prepare("SELECT * FROM providers WHERE id = ?").get(workerProvider?.value) as any;

  if (!provider || !workerModel) {
    throw new Error('Worker engine not configured.');
  }

  const messages = [
    {
      role: 'system',
      content: `You are Henry AI Worker — a code generation engine. Produce clean, production-quality code. Include proper types, error handling, and comments. Output complete files, never partial snippets.

Language: ${payload.language || 'TypeScript'}
Framework: ${payload.framework || 'Not specified'}
${payload.context ? `Context:\n${payload.context}` : ''}`,
    },
    {
      role: 'user',
      content: payload.prompt || task.description,
    },
  ];

  const { callAI } = require('./ai');
  const result = await callAI({
    provider: workerProvider.value,
    model: workerModel.value,
    apiKey: provider.api_key,
    messages,
    temperature: 0.3, // Lower temp for code gen
    signal,
  });

  return {
    type: 'code_generation',
    content: result.content,
    model: workerModel.value,
    tokens: result.usage,
    cost: result.cost,
  };
}

// Research task
async function executeResearchTask(task: any, payload: any, signal: AbortSignal): Promise<any> {
  return executeAITask(task, {
    ...payload,
    prompt: `Research the following thoroughly and provide a comprehensive summary with sources and key findings:\n\n${payload.prompt || task.description}`,
  }, signal);
}
