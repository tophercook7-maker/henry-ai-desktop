/**
 * Filesystem — Sandboxed file operations scoped to a workspace directory.
 *
 * IPC channels (match preload.ts):
 *   fs:readDirectory, fs:readFile, fs:writeFile
 */

import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

export function registerFilesystemHandlers(workspacePath: string) {
  // Resolve and validate that requested paths are inside the workspace
  function safePath(requestedPath: string): string {
    const resolved = path.resolve(workspacePath, requestedPath);
    if (!resolved.startsWith(path.resolve(workspacePath))) {
      throw new Error('Access denied: path is outside workspace.');
    }
    return resolved;
  }

  // Read directory
  ipcMain.handle('fs:readDirectory', async (_, dirPath?: string) => {
    const targetDir = dirPath ? safePath(dirPath) : workspacePath;

    if (!fs.existsSync(targetDir)) {
      return { path: dirPath || '.', entries: [] };
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    return {
      path: dirPath || '.',
      entries: entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => {
          const fullPath = path.join(targetDir, e.name);
          const stat = fs.statSync(fullPath);
          return {
            name: e.name,
            path: path.relative(workspacePath, fullPath),
            isDirectory: e.isDirectory(),
            size: stat.size,
            modified: stat.mtime.toISOString(),
          };
        }),
    };
  });

  // Read file
  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    const target = safePath(filePath);
    if (!fs.existsSync(target)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(target, 'utf-8');
  });

  // Write file — preload sends { path, content }
  ipcMain.handle('fs:writeFile', async (_, data: { path: string; content: string }) => {
    const target = safePath(data.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data.content, 'utf-8');
    return true;
  });
}
