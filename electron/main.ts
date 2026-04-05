import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { initDatabase, getDb } from './ipc/database';
import { registerAiHandlers } from './ipc/ai';
import { registerFileHandlers } from './ipc/filesystem';
import { registerSettingsHandlers } from './ipc/settings';

let mainWindow: BrowserWindow | null = null;

// Henry's data directory
const HENRY_DATA_DIR = path.join(app.getPath('userData'), 'HenryAI');
const HENRY_WORKSPACE_DIR = path.join(app.getPath('documents'), 'Henry AI Workspace');

function ensureDirectories() {
  const dirs = [
    HENRY_DATA_DIR,
    HENRY_WORKSPACE_DIR,
    path.join(HENRY_WORKSPACE_DIR, 'Projects'),
    path.join(HENRY_WORKSPACE_DIR, 'Documents'),
    path.join(HENRY_WORKSPACE_DIR, 'Notes'),
  ];
  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
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
      sandbox: false,
    },
    show: false,
  });

  // Show window when ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC: Get paths
ipcMain.handle('get-paths', () => ({
  data: HENRY_DATA_DIR,
  workspace: HENRY_WORKSPACE_DIR,
  home: app.getPath('home'),
  documents: app.getPath('documents'),
}));

// IPC: Window controls
ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window-close', () => mainWindow?.close());

// IPC: Open folder dialog
ipcMain.handle('dialog-open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// App lifecycle
app.whenReady().then(() => {
  ensureDirectories();
  initDatabase(HENRY_DATA_DIR);
  registerAiHandlers();
  registerFileHandlers(HENRY_WORKSPACE_DIR);
  registerSettingsHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
