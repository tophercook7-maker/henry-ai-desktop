import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  extension?: string;
}

export function registerFileHandlers(workspacePath: string) {
  // Read workspace directory
  ipcMain.handle('fs-read-workspace', (_, subpath?: string) => {
    const targetPath = subpath
      ? path.join(workspacePath, subpath)
      : workspacePath;

    if (!fs.existsSync(targetPath)) {
      return [];
    }

    const entries: FileEntry[] = [];
    const items = fs.readdirSync(targetPath, { withFileTypes: true });

    for (const item of items) {
      if (item.name.startsWith('.')) continue; // Skip hidden files

      const fullPath = path.join(targetPath, item.name);
      const stat = fs.statSync(fullPath);

      entries.push({
        name: item.name,
        path: fullPath,
        type: item.isDirectory() ? 'directory' : 'file',
        size: item.isFile() ? stat.size : undefined,
        modified: stat.mtime.toISOString(),
        extension: item.isFile() ? path.extname(item.name) : undefined,
      });
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return entries;
  });

  // Read file content
  ipcMain.handle('fs-read-file', (_, filepath: string) => {
    if (!fs.existsSync(filepath)) {
      throw new Error(`File not found: ${filepath}`);
    }
    return fs.readFileSync(filepath, 'utf-8');
  });

  // Write file
  ipcMain.handle(
    'fs-write-file',
    (_, filepath: string, content: string) => {
      const dir = path.dirname(filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filepath, content, 'utf-8');
      return true;
    }
  );
}
