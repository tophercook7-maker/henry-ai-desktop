import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { initDatabase } from './ipc/database';
import { registerSettingsHandlers } from './ipc/settings';
import { registerAIHandlers } from './ipc/ai';
import { registerFilesystemHandlers } from './ipc/filesystem';
import { registerTaskBrokerHandlers } from './ipc/taskBroker';
import { registerMemoryHandlers } from './ipc/memory';
import { registerScriptureHandlers } from './ipc/scripture';
import { registerOllamaHandlers } from './ipc/ollama';
import { registerTerminalHandlers } from './ipc/terminal';

let mainWindow: BrowserWindow | null = null;

/**
 * Always returns the current live BrowserWindow (or null).
 * Passed to IPC handlers so they never hold a stale reference —
 * critical during Vite HMR where the renderer reloads.
 */
export function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  // Fallback: find any open window
  const wins = BrowserWindow.getAllWindows();
  return wins.find((w) => !w.isDestroyed()) || null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    if (process.env.OPEN_DEVTOOLS === 'true') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  const fs = require('fs');
  const userDataPath = app.getPath('userData');
  const henryDir = path.join(userDataPath, 'henry-workspace');
  if (!fs.existsSync(henryDir)) {
    fs.mkdirSync(henryDir, { recursive: true });
  }

  // Initialize database with the workspace directory
  const db = initDatabase(henryDir);

  createWindow();

  // Register all IPC handlers — pass getMainWindow getter so handlers
  // always use the live window, even after Vite HMR reloads.
  registerSettingsHandlers(db);
  registerAIHandlers(db, getMainWindow);
  registerFilesystemHandlers(henryDir);
  registerTaskBrokerHandlers(db, getMainWindow, henryDir);
  registerMemoryHandlers(db);
  registerScriptureHandlers(db, getMainWindow);
  registerOllamaHandlers(getMainWindow);
  registerTerminalHandlers(getMainWindow, henryDir);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
