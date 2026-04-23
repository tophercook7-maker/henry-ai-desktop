/**
 * Computer Control — Henry's ability to operate macOS and Windows.
 *
 * Built on top of the existing terminal executor. Uses AppleScript on Mac
 * and PowerShell/WSH on Windows. No additional npm packages needed.
 *
 * Mac permissions required:
 *   - Accessibility: System Settings → Privacy & Security → Accessibility → Henry AI
 *   - Screen Recording: System Settings → Privacy & Security → Screen Recording → Henry AI
 */

import { ipcMain, BrowserWindow, app } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

type WindowGetter = () => BrowserWindow | null;

export function registerComputerHandlers(winGetter: WindowGetter) {
  const platform = process.platform;

  // ── Helper: run a shell command and capture output ───────────────────
  function runCmd(command: string, timeout = 15000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const shell = platform === 'win32' ? ['cmd', ['/c', command]] : ['sh', ['-c', command]];
      const child = spawn(shell[0] as string, shell[1] as string[], { timeout });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('close', (code: number | null) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
      child.on('error', (e: Error) => resolve({ stdout: '', stderr: e.message, exitCode: -1 }));
    });
  }

  // ── Screenshot ────────────────────────────────────────────────────────
  ipcMain.handle('computer:screenshot', async (_event, params: { region?: { x: number; y: number; w: number; h: number } } = {}) => {
    const tmpFile = path.join(os.tmpdir(), `henry_screenshot_${Date.now()}.png`);
    let cmd: string;

    if (platform === 'darwin') {
      if (params.region) {
        const { x, y, w, h } = params.region;
        cmd = `screencapture -x -R${x},${y},${w},${h} "${tmpFile}"`;
      } else {
        cmd = `screencapture -x "${tmpFile}"`;
      }
    } else if (platform === 'win32') {
      // PowerShell screenshot
      cmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bmp.Save('${tmpFile}') }"`;
    } else {
      // Linux with scrot
      cmd = `scrot "${tmpFile}" 2>/dev/null || import -window root "${tmpFile}" 2>/dev/null`;
    }

    const result = await runCmd(cmd, 10000);
    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr || 'Screenshot failed. Check Screen Recording permission in System Settings.', base64: null };
    }

    try {
      const data = fs.readFileSync(tmpFile);
      const base64 = data.toString('base64');
      fs.unlinkSync(tmpFile);
      return { success: true, base64, mimeType: 'image/png' };
    } catch (e: any) {
      return { success: false, error: e.message, base64: null };
    }
  });

  // ── Open App ──────────────────────────────────────────────────────────
  ipcMain.handle('computer:openApp', async (_event, appName: string) => {
    try {  
      let cmd: string;
      if (platform === 'darwin') {
        cmd = `open -a "${appName}" 2>&1`;
      } else if (platform === 'win32') {
        cmd = `start "" "${appName}"`;
      } else {
        cmd = `xdg-open "${appName}" 2>&1 || gtk-launch "${appName}" 2>&1`;
      }
      const result = await runCmd(cmd, 10000);
      return {
        success: result.exitCode === 0,
        output: result.stdout || result.stderr,
      };    } catch (e: unknown) {
      console.error('[computer:openApp]', e instanceof Error ? e.message : String(e));
      throw e;
    }

  });

  // ── Open URL in default browser ───────────────────────────────────────
  ipcMain.handle('computer:openUrl', async (_event, url: string) => {
    try {  
      let cmd: string;
      if (platform === 'darwin') {
        cmd = `open "${url}"`;
      } else if (platform === 'win32') {
        cmd = `start "" "${url}"`;
      } else {
        cmd = `xdg-open "${url}"`;
      }
      const result = await runCmd(cmd, 5000);
      return { success: result.exitCode === 0, output: result.stdout || result.stderr };    } catch (e: unknown) {
      console.error('[computer:openUrl]', e instanceof Error ? e.message : String(e));
      throw e;
    }

  });

  // ── AppleScript ───────────────────────────────────────────────────────
  ipcMain.handle('computer:osascript', async (_event, script: string) => {
    try {  
      if (platform !== 'darwin') {
        return { success: false, error: 'AppleScript only supported on macOS', output: '' };
      }
      const result = await runCmd(`osascript -e '${script.replace(/'/g, "'\\''")}'`, 30000);
      return {
        success: result.exitCode === 0,
        output: result.stdout.trim(),
        error: result.exitCode !== 0 ? result.stderr.trim() : undefined,
      };    } catch (e: unknown) {
      console.error('[computer:osascript]', e instanceof Error ? e.message : String(e));
      throw e;
    }

  });

  // ── Run shell command (with allowlist safety) ─────────────────────────
  ipcMain.handle('computer:runShell', async (_event, params: { command: string; timeout?: number }) => {
    try {  
      const BLOCKED = ['rm -rf /', 'mkfs', 'shutdown', 'reboot', 'halt', ':(){:|:&};:'];
      const lower = params.command.toLowerCase();
      for (const b of BLOCKED) {
        if (lower.includes(b)) {
          return { success: false, error: `Command blocked: "${b}"`, output: '' };
        }
      }
      const result = await runCmd(params.command, params.timeout || 30000);
      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr || undefined,
        exitCode: result.exitCode,
      };    } catch (e: unknown) {
      console.error('[computer:runShell]', e instanceof Error ? e.message : String(e));
      throw e;
    }

  });

  // ── Get running apps ──────────────────────────────────────────────────
  ipcMain.handle('computer:listApps', async () => {
    try {  
      let cmd: string;
      if (platform === 'darwin') {
        cmd = `ls /Applications/*.app | sed 's|/Applications/||' | sed 's|.app||' | head -60`;
      } else if (platform === 'win32') {
        cmd = `powershell -Command "Get-StartApps | Select-Object -First 60 Name | ConvertTo-Json"`;
      } else {
        cmd = `ls /usr/share/applications/*.desktop | sed 's|/usr/share/applications/||' | sed 's|.desktop||' | head -60`;
      }
      const result = await runCmd(cmd, 5000);
      const apps = result.stdout.trim().split('\n').filter(Boolean).map(a => a.trim());
      return { apps, platform };    } catch (e: unknown) {
      console.error('[computer:listApps]', e instanceof Error ? e.message : String(e));
      throw e;
    }

  });

  // ── Get running processes ─────────────────────────────────────────────
  ipcMain.handle('computer:listProcesses', async () => {
    try {  
      let cmd: string;
      if (platform === 'darwin') {
        cmd = `ps aux | awk 'NR>1 {print $11}' | sort -u | grep -v '\\[' | head -40`;
      } else if (platform === 'win32') {
        cmd = `tasklist /FO CSV | head -40`;
      } else {
        cmd = `ps aux | awk 'NR>1 {print $11}' | sort -u | head -40`;
      }
      const result = await runCmd(cmd, 5000);
      return { processes: result.stdout.trim().split('\n').filter(Boolean) };    } catch (e: unknown) {
      console.error('[computer:listProcesses]', e instanceof Error ? e.message : String(e));
      throw e;
    }

  });

  // ── Permission check ──────────────────────────────────────────────────
  ipcMain.handle('computer:checkPermissions', async () => {
    try {  
      if (platform !== 'darwin') {
        return { platform, accessibility: true, screenRecording: true, message: 'Permissions apply to macOS only.' };
      }
  
      // Check Accessibility
      const accessResult = await runCmd(
        `osascript -e 'tell application "System Events" to return name of first process whose frontmost is true' 2>&1`,
        5000
      );
      const hasAccessibility = accessResult.exitCode === 0 && !accessResult.stdout.includes('not allowed');
  
      // Check Screen Recording (try screenshot)
      const tmpCheck = path.join(os.tmpdir(), 'henry_perm_check.png');
      const srResult = await runCmd(`screencapture -x "${tmpCheck}" 2>&1 && rm -f "${tmpCheck}"`, 5000);
      const hasScreenRecording = srResult.exitCode === 0;
  
      return {
        platform: 'darwin',
        accessibility: hasAccessibility,
        screenRecording: hasScreenRecording,
        accessibilityInstructions: !hasAccessibility
          ? 'Open System Settings → Privacy & Security → Accessibility → enable Henry AI'
          : null,
        screenRecordingInstructions: !hasScreenRecording
          ? 'Open System Settings → Privacy & Security → Screen Recording → enable Henry AI'
          : null,
      };    } catch (e: unknown) {
      console.error('[computer:checkPermissions]', e instanceof Error ? e.message : String(e));
      throw e;
    }

  });

  // ── Type text (requires Accessibility) ───────────────────────────────
  ipcMain.handle('computer:typeText', async (_event, text: string) => {
    try {  
      if (platform !== 'darwin') {
        return { success: false, error: 'Keyboard control via AppleScript is macOS only.' };
      }
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const result = await runCmd(
        `osascript -e 'tell application "System Events" to keystroke "${escaped}"'`,
        10000
      );
      return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined };    } catch (e: unknown) {
      console.error('[computer:typeText]', e instanceof Error ? e.message : String(e));
      throw e;
    }

  });

  // ── Click at coordinates (requires Accessibility) ─────────────────────
  ipcMain.handle('computer:click', async (_event, params: { x: number; y: number; button?: string }) => {
    try {  
      if (platform !== 'darwin') {
        return { success: false, error: 'Mouse control via AppleScript is macOS only.' };
      }
      const { x, y, button = 'primary' } = params;
      const btnStr = button === 'right' ? 'right' : '';
      const result = await runCmd(
        `osascript -e 'tell application "System Events" to ${btnStr ? 'right ' : ''}click at {${x}, ${y}}'`,
        10000
      );
      return { success: result.exitCode === 0, error: result.exitCode !== 0 ? result.stderr : undefined };    } catch (e: unknown) {
      console.error('[computer:click]', e instanceof Error ? e.message : String(e));
      throw e;
    }

  });

  // ── Get system info ───────────────────────────────────────────────────
  ipcMain.handle('computer:systemInfo', async () => {
    try {  
      const info: Record<string, unknown> = {
        platform,
        arch: process.arch,
        hostname: os.hostname(),
        homeDir: os.homedir(),
        appVersion: app.getVersion(),
        totalMemoryGB: (os.totalmem() / 1024 / 1024 / 1024).toFixed(1),
        freeMemoryGB: (os.freemem() / 1024 / 1024 / 1024).toFixed(1),
      };
      if (platform === 'darwin') {
        const sw = await runCmd('sw_vers', 3000);
        info.macOS = sw.stdout.trim();
      }
      return info;    } catch (e: unknown) {
      console.error('[computer:systemInfo]', e instanceof Error ? e.message : String(e));
      throw e;
    }

  });
}
