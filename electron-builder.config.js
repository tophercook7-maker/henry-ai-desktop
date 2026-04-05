/**
 * Electron Builder configuration for Henry AI Desktop.
 * Builds cross-platform installers: macOS (.dmg), Windows (.exe), Linux (.AppImage/.deb).
 * 
 * Run: npm run build && npx electron-builder
 */

module.exports = {
  appId: 'ai.henry.desktop',
  productName: 'Henry AI',
  copyright: 'Copyright © 2026',

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

  // macOS
  mac: {
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
    ],
    category: 'public.app-category.developer-tools',
    icon: 'build/icon.icns',
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
    icon: 'build/icon.ico',
    requestedExecutionLevel: 'asInvoker',
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Henry AI',
    installerIcon: 'build/icon.ico',
    installerSidebar: 'build/installerSidebar.bmp',
  },

  // Linux
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64', 'arm64'] },
      { target: 'deb', arch: ['x64', 'arm64'] },
    ],
    category: 'Development',
    icon: 'build/icons',
    synopsis: 'Henry AI — Your personal AI operating system',
    description: 'A local-first desktop AI assistant with dual-engine architecture, multi-provider support, and workspace management.',
  },

  // Auto-update (for future use)
  publish: null,
};
