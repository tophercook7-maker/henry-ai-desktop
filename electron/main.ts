import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { autoUpdater } from 'electron-updater';
import { Menu, MenuItem } from 'electron';
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
import { registerSyncBridgeIpc, setSyncDb, startSyncServer } from './ipc/syncBridge';


// Global IPC error handler — prevents any single handler crash from killing the process
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Henry:main] Unhandled IPC rejection:', reason);
  // Don't exit — let the renderer receive the error via the normal IPC error channel
});

process.on('uncaughtException', (err) => {
  console.error('[Henry:main] Uncaught exception:', err.message);
  // Log but don't crash — try to keep running
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
    // After renderer loads: sync SQLite settings → localStorage
    // This runs BEFORE webMock reads from localStorage, ensuring correct provider/model
    mainWindow.webContents.on('did-finish-load', async () => {
      try {
        const db = (await import('./ipc/database')).getDb();
        const settings = db.prepare('SELECT key, value FROM settings').all() as {key:string, value:string}[];
        const providers = db.prepare('SELECT id, name, api_key, enabled, models FROM providers').all() as any[];

        const settingsMap: Record<string, string> = {};
        for (const { key, value } of settings) settingsMap[key] = value;

        const providersArr = providers.map(p => ({
          id: p.id, name: p.name,
          api_key: p.api_key || '', apiKey: p.api_key || '',
          enabled: Boolean(p.enabled), models: p.models || '[]',
        }));

        const script = `
          try {
            const s = ${JSON.stringify(settingsMap)};
            const existing = JSON.parse(localStorage.getItem('henry:settings') || '{}');
            localStorage.setItem('henry:settings', JSON.stringify({...existing, ...s}));
            localStorage.setItem('henry:providers', JSON.stringify(${JSON.stringify(providersArr)}));
            console.log('[Henry] SQLite→localStorage sync complete. provider:', s.companion_provider, 'model:', s.companion_model);
          } catch(e) { console.error('[Henry] localStorage sync failed:', e); }
        `;
        mainWindow!.webContents.executeJavaScript(script);

        // Inject real system paths so Henry never uses placeholder usernames
        const sysPath = await import('path');
        const sysOs = await import('os');
        const homeDir = sysOs.default.homedir();
        const macUser = homeDir.split(sysPath.default.sep).pop() || '';
        const pathScript = `
          try {
            localStorage.setItem('henry:mac_username', ${JSON.stringify(macUser)});
            localStorage.setItem('henry:mac_home', ${JSON.stringify(homeDir)});
            console.log('[Henry] System paths set — user: ${macUser}');
          } catch(e) {}
        `;
        mainWindow!.webContents.executeJavaScript(pathScript);

        // ALWAYS inject real computer control via sync server
        // Don't test for mock first — just override unconditionally
        // The sync server is already running and works regardless of webMock state
        const computerOverrideScript = `
          (function installRealComputer() {
            const BASE = 'http://127.0.0.1:4242';
            const H = {'Content-Type':'application/json','X-Henry-Internal':'true'};

            const post = (path, body) =>
              fetch(BASE + path, {method:'POST', headers:H, body:JSON.stringify(body)})
                .then(r => r.json())
                .catch(e => ({ok:false, success:false, error:String(e)}));

            window.henryAPI.computerRunShell   = p => post('/computer/shell',     {command: p.command});
            window.henryAPI.computerNewFolder  = p => post('/computer/newfolder', {path: p.path});
            window.henryAPI.computerOpenApp    = n => post('/computer/openapp',   {name: typeof n==='string'?n:n.name||n});
            window.henryAPI.computerScreenshot = () => post('/computer/screenshot', {});
            window.henryAPI.computerOsascript  = s => post('/computer/osascript', {script: typeof s==='string'?s:s.script||s});

            console.log('[Henry] Real computer IPC installed via sync server');
          })();
        `;
        mainWindow!.webContents.executeJavaScript(computerOverrideScript).catch(() => {});

        // Check permissions and notify renderer so it can show the permission prompt
                // Check permissions and notify renderer so it can show the permission prompt
        if (process.platform === 'darwin') {
          const { execSync } = await import('child_process');
          let accessibility = false;
          let screenRecording = false;

          try {
            execSync(`osascript -e 'tell application "System Events" to return name of first process whose frontmost is true'`, { stdio: 'ignore', timeout: 3000 });
            accessibility = true;
          } catch { /* not granted */ }

          try {
            const tmpPng = require('path').join(require('os').tmpdir(), 'henry_perm.png');
            execSync(`screencapture -x "${tmpPng}" && rm -f "${tmpPng}"`, { stdio: 'ignore', timeout: 3000 });
            screenRecording = true;
          } catch { /* not granted */ }

          if (!accessibility || !screenRecording) {
            const permScript = `
              window.__henry_permissions = ${JSON.stringify({ accessibility, screenRecording })};
              window.dispatchEvent(new CustomEvent('henry_permissions_ready', {
                detail: ${JSON.stringify({ accessibility, screenRecording })}
              }));
            `;
            mainWindow!.webContents.executeJavaScript(permScript);
          }
        }
      } catch (e) {
        console.error('[Henry] SQLite→localStorage sync error:', e);
      }
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Right-click context menu with copy/paste/cut/select all
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu();
    if (params.isEditable) {
      if (params.selectionText) {
        menu.append(new MenuItem({ label: 'Cut',        role: 'cut',       accelerator: 'CmdOrCtrl+X' }));
        menu.append(new MenuItem({ label: 'Copy',       role: 'copy',      accelerator: 'CmdOrCtrl+C' }));
      }
      menu.append(new MenuItem({ label: 'Paste',        role: 'paste',     accelerator: 'CmdOrCtrl+V' }));
      menu.append(new MenuItem({ label: 'Select All',   role: 'selectAll', accelerator: 'CmdOrCtrl+A' }));
    } else if (params.selectionText) {
      menu.append(new MenuItem({ label: 'Copy',         role: 'copy',      accelerator: 'CmdOrCtrl+C' }));
    }
    if (menu.items.length > 0) {
      menu.popup({ window: mainWindow! });
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  const henryDir = path.join(userDataPath, 'henry-workspace');
  if (!fs.existsSync(henryDir)) {
    fs.mkdirSync(henryDir, { recursive: true });
  }

  const db = initDatabase(henryDir);

  createWindow();

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

  // ── Companion Sync Bridge ────────────────────────────────────────────────
  setSyncDb(db);
  registerSyncBridgeIpc();
  // Auto-start sync server so companion devices can connect immediately
  startSyncServer(4242);

  // ── Auto-updater ────────────────────────────────────────────────────────────
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

  ipcMain.handle('updater:check', () => {
    return autoUpdater.checkForUpdates().catch(() => null);
  });
  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // Check silently after 10 s so first launch isn't slowed down
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => null);
  }, 10_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
