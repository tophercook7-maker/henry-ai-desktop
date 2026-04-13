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
    mainWindow.loadFile(path.join(__dirname, '../index.html'));
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

  // Always create the window first so the user sees something even if DB init fails.
  createWindow();

  let db: ReturnType<typeof initDatabase>;
  try {
    db = initDatabase(henryDir);
  } catch (err) {
    console.error('[Henry] Database init failed:', err);
    getMainWindow()?.webContents.once('did-finish-load', () => {
      getMainWindow()?.webContents.send('henry:db-error', String(err));
    });
    return;
  }

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

  // ── Auto-updater ────────────────────────────────────────────────────────────
  // Disabled on macOS until the app is code-signed.
  // Unsigned macOS builds reject auto-update entirely; enabling it causes noise.
  // Windows and Linux auto-update works without signing.
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
