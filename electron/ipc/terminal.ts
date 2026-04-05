/**
 * Terminal — Execute shell commands from Henry.
 * 
 * Sandboxed execution with configurable working directory,
 * timeout, and output capture. Worker engine uses this for
 * code execution, npm tasks, git operations, etc.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

type WindowGetter = () => BrowserWindow | null;

/** Safely send to renderer — skips if window is destroyed (Vite HMR). */
function safeSend(getWin: WindowGetter, channel: string, data: any) {
  const win = getWin();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

let getWindow: WindowGetter;
const activeProcesses: Map<string, ChildProcess> = new Map();

// Commands that are always blocked for safety
const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  'shutdown',
  'reboot',
  'halt',
];

export function registerTerminalHandlers(winGetter: WindowGetter, workspacePath: string) {
  getWindow = winGetter;

  // Execute a command
  ipcMain.handle('terminal:exec', async (_event, params: {
    command: string;
    cwd?: string;
    timeout?: number;
    channelId?: string;
  }) => {
    // Safety check
    const lowerCmd = params.command.toLowerCase();
    for (const blocked of BLOCKED_COMMANDS) {
      if (lowerCmd.includes(blocked)) {
        return {
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: `Command blocked for safety: contains "${blocked}"`,
        };
      }
    }

    const execId = crypto.randomUUID();
    const cwd = params.cwd || workspacePath;
    const timeout = params.timeout || 30000; // Default 30s timeout

    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', params.command], {
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
        timeout,
      });

      activeProcesses.set(execId, child);

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        // Stream output to renderer if channelId provided
        if (params.channelId) {
          safeSend(getWindow, 'terminal:output', {
            channelId: params.channelId,
            execId,
            type: 'stdout',
            data: chunk,
          });
        }
      });

      child.stderr?.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (params.channelId) {
          safeSend(getWindow, 'terminal:output', {
            channelId: params.channelId,
            execId,
            type: 'stderr',
            data: chunk,
          });
        }
      });

      child.on('close', (code) => {
        activeProcesses.delete(execId);
        if (params.channelId) {
          safeSend(getWindow, 'terminal:done', {
            channelId: params.channelId,
            execId,
            exitCode: code,
          });
        }
        resolve({
          success: code === 0,
          exitCode: code,
          stdout: stdout.slice(0, 100000), // Cap at 100KB
          stderr: stderr.slice(0, 50000),
          execId,
        });
      });

      child.on('error', (err) => {
        activeProcesses.delete(execId);
        resolve({
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: err.message,
          execId,
        });
      });
    });
  });

  // Kill a running process
  ipcMain.handle('terminal:kill', async (_event, execId: string) => {
    const child = activeProcesses.get(execId);
    if (child) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
      activeProcesses.delete(execId);
      return { killed: true };
    }
    return { killed: false, error: 'Process not found' };
  });

  // Get list of active processes
  ipcMain.handle('terminal:active', async () => {
    return {
      count: activeProcesses.size,
      ids: Array.from(activeProcesses.keys()),
    };
  });
}
