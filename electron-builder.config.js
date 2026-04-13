/**
 * Electron Builder configuration for Henry AI Desktop.
 * Single source of truth — package.json "build" field has been removed.
 *
 * Icons: place icon.icns (Mac), icon.ico (Windows), icons/ (Linux) in build/
 * Signing: set CSC_LINK + CSC_KEY_PASSWORD env vars for Mac; unsigned uses --config.mac.identity=null
 */

module.exports = {
  appId: 'ai.henry.desktop',
  productName: 'Henry AI',
  copyright: 'Copyright © 2026 Henry AI',

  directories: {
    buildResources: 'build',
    output: 'release',
  },

  files: [
    'dist/**/*',
    'dist-electron/**/*',
    '!node_modules/**/*',
    'node_modules/better-sqlite3/**/*',
  ],

  // macOS — unsigned builds use: electron-builder --mac --config.mac.identity=null
  mac: {
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
    ],
    category: 'public.app-category.developer-tools',
    // icon: 'build/icon.icns' — add when icon file exists
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },

  dmg: {
    backgroundColor: '#0a0a0f',
    title: 'Henry AI',
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },

  // Windows
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
    ],
    // icon: 'build/icon.ico' — add when icon file exists
    requestedExecutionLevel: 'asInvoker',
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Henry AI',
    // installerIcon / installerSidebar — add when icon files exist
  },

  // Linux
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64', 'arm64'] },
      { target: 'deb', arch: ['x64', 'arm64'] },
    ],
    category: 'Development',
    // icon: 'build/icons' — add when icon directory exists
    synopsis: 'Henry AI — Your personal AI operating system',
    description: 'A local-first desktop AI assistant with dual-engine architecture, multi-provider support, and workspace management.',
  },

  // publish: null — CI creates GitHub Releases via softprops/action-gh-release
  publish: null,
};
