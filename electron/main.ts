import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import { autoUpdater } from 'electron-updater';
import { initDatabase } from './ipc/database';
import { registerSettingsHandlers } from './ipc/settings';
import { registerAIHandlers } from './ipc/ai';
import { registerFilesystemHandlers } from './ipc/filesystem';
import { registerTaskBrokerHandlers } from './ipc/taskBroker';
import { registerMemoryHandlers } from './ipc/memory';
import { registerScriptureHandlers } from './ipc/scripture';
import { registerOllamaHandlers } from './ipc/ollama';
import { registerOllamaCleanup } from './ipc/ollamaManager';
import { registerTerminalHandlers } from './ipc/terminal';
import { registerComputerHandlers } from './ipc/computer';
import { registerPrinterHandlers } from './ipc/printer';

// ── Temporary diagnostics — remove when black-screen root cause is confirmed ──
process.on('uncaughtException', (err) => {
  console.error('[Henry] uncaughtException in main process:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Henry] unhandledRejection in main process:', reason);
});

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
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
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    // Temporary: open DevTools in packaged mode when HENRY_DEBUG=true
    if (process.env.HENRY_DEBUG === 'true') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Surface renderer load failures in the main-process console (visible in crash logs).
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[Henry] Renderer failed to load — code=${code} desc=${desc} url=${url}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[Henry] Render process gone — reason=${details.reason} exitCode=${details.exitCode}`);
  });

  // Temporary: pipe all renderer console output to the main-process log
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = ['verbose', 'info', 'warning', 'error'][level] ?? 'log';
    console.log(`[Henry:renderer:${tag}] ${message}  (${sourceId}:${line})`);
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

  // ── 1. Init database ─────────────────────────────────────────────────────────
  let db: ReturnType<typeof initDatabase> | null = null;
  let dbError: string | null = null;
  try {
    db = initDatabase(henryDir);
  } catch (err) {
    dbError = String(err);
    console.error('[Henry] Database init failed:', err);
  }

  // ── 2. Register all IPC handlers before the window opens ────────────────────
  //
  // The window is intentionally created AFTER all handlers are registered so
  // the renderer can never call window.henryAPI before a matching ipcMain.handle
  // exists.  Previously createWindow() was called first, introducing a race where
  // the renderer's initApp() IPC calls could fire before handlers were ready.
  //
  if (db) {
    registerSettingsHandlers(db);
    registerAIHandlers(db, getMainWindow);
    registerFilesystemHandlers(henryDir);
    registerTaskBrokerHandlers(db, getMainWindow, henryDir);
    registerMemoryHandlers(db);
    registerScriptureHandlers(db, getMainWindow);
    registerOllamaHandlers(getMainWindow);
    registerOllamaCleanup();
    registerTerminalHandlers(getMainWindow, henryDir);
    registerComputerHandlers(getMainWindow);
    registerPrinterHandlers(getMainWindow);
  } else {
    // DB failed — register minimal stubs for the three channels called
    // unconditionally by the renderer's initApp() so they return safely instead
    // of hanging (Electron 31 rejects unregistered invokes, but being explicit is
    // safer and surfaces the real error rather than a generic IPC rejection).
    ipcMain.handle('settings:getAll', () => ({}));
    ipcMain.handle('settings:save', () => false);
    ipcMain.handle('providers:getAll', () => []);
    ipcMain.handle('providers:save', () => false);
    ipcMain.handle('conversations:getAll', () => []);
  }

  // ── 3. Register updater IPC handlers ────────────────────────────────────────
  const updaterEnabled = process.platform !== 'darwin';

  if (updaterEnabled) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', () => {
      getMainWindow()?.webContents.send('updater:update-available');
    });
    autoUpdater.on('update-downloaded', () => {
      getMainWindow()?.webContents.send('updater:update-downloaded');
    });
    autoUpdater.on('error', (err: Error) => {
      console.error('[AutoUpdater] Error:', err.message);
    });

    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => null);
    }, 10_000);
  }

  ipcMain.handle('updater:check', () => {
    if (!updaterEnabled) return null;
    return autoUpdater.checkForUpdates().catch(() => null);
  });
  ipcMain.handle('updater:install', () => {
    if (!updaterEnabled) return;
    autoUpdater.quitAndInstall(false, true);
  });

  // ── 4. Open the window — every ipcMain.handle is now registered ─────────────
  createWindow();

  // Surface DB error to the renderer after its page finishes loading.
  if (dbError) {
    getMainWindow()?.webContents.once('did-finish-load', () => {
      getMainWindow()?.webContents.send('henry:db-error', dbError);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
