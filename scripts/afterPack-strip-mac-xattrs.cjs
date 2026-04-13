/**
 * electron-builder afterPack — runs after the .app is assembled, before codesign.
 * Clears Finder/resource-fork metadata that makes codesign fail with:
 * "resource fork, Finder information, or similar detritus not allowed"
 *
 * @see https://developer.apple.com/library/archive/qa/qa1940/_index.html
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function afterPackStripMacXattrs(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const productFile = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productFile}.app`);

  if (!fs.existsSync(appPath)) {
    console.warn(`[afterPack] skip strip: missing ${appPath}`);
    return;
  }

  console.info(`[afterPack] stripping xattrs / AppleDouble from ${appPath}`);

  try {
    execFileSync('dot_clean', ['-m', appPath], { stdio: 'inherit' });
  } catch {
    /* dot_clean missing or nothing to merge — safe to ignore */
  }

  try {
    execFileSync('find', [appPath, '-name', '._*', '-type', 'f', '-delete'], { stdio: 'inherit' });
  } catch {
    /* ignore */
  }

  // Whole tree (Frameworks, Resources, all Mach-O files, nested helper .app bundles).
  execFileSync('/usr/bin/xattr', ['-cr', appPath], { stdio: 'inherit' });

  // Explicit pass on each nested *.app (e.g. "Henry AI Helper (GPU).app") — ensures
  // bundle roots are cleared even if tooling treats them specially before codesign.
  try {
    const nested = execFileSync(
      '/usr/bin/find',
      [appPath, '-name', '*.app', '-type', 'd'],
      { encoding: 'utf8' }
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const bundle of nested) {
      if (bundle !== appPath) {
        execFileSync('/usr/bin/xattr', ['-cr', bundle], { stdio: 'inherit' });
      }
    }
  } catch {
    /* ignore */
  }
};
