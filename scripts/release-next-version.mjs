#!/usr/bin/env node
/**
 * Prepares the next semver in package.json, commits if needed, tags v<version>,
 * and pushes branch + tag. If v<current> already exists locally or on origin,
 * patch is incremented until a free tag is found.
 *
 * Usage: node scripts/release-next-version.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkgPath = join(root, 'package.json');

const dryRun = process.argv.includes('--dry-run');

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', cwd: root, stdio: dryRun ? 'pipe' : 'inherit', ...opts });
}

function shOut(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: root }).trim();
}

function parseSemver(s) {
  const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(String(s).trim());
  if (!m) throw new Error(`Invalid semver in package.json: ${s}`);
  return { major: +m[1], minor: +m[2], patch: +m[3], rest: m[4] ?? '' };
}

function formatSemver(p) {
  return `${p.major}.${p.minor}.${p.patch}${p.rest}`;
}

function bumpPatch(ver) {
  const p = parseSemver(ver);
  p.patch += 1;
  return formatSemver(p);
}

function localTagExists(tag) {
  try {
    shOut(`git show-ref --verify --quiet refs/tags/${tag}`);
    return true;
  } catch {
    return false;
  }
}

function remoteTagExists(tag) {
  try {
    const line = shOut(`git ls-remote origin refs/tags/${tag}`);
    return line.length > 0;
  } catch {
    return false;
  }
}

function tagTaken(tag) {
  return localTagExists(tag) || remoteTagExists(tag);
}

function readPkg() {
  return JSON.parse(readFileSync(pkgPath, 'utf8'));
}

function writePkg(pkg) {
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function syncLockfile() {
  if (dryRun) {
    console.log('[dry-run] would run: npm install --package-lock-only');
    return;
  }
  sh('npm install --package-lock-only', { stdio: 'inherit' });
}

function main() {
  if (!dryRun) {
    try {
      sh('git fetch origin --tags', { stdio: 'pipe' });
    } catch {
      console.warn('warning: git fetch origin --tags failed (offline?); using local tag state only');
    }
  }

  const pkg = readPkg();
  const original = pkg.version;
  let ver = original;

  while (tagTaken(`v${ver}`)) {
    console.log(`Tag v${ver} already exists (local or origin); bumping patch…`);
    ver = bumpPatch(ver);
  }

  if (ver !== original) {
    console.log(`Resolved version ${original} → ${ver} (free tag v${ver})`);
    pkg.version = ver;
    if (!dryRun) writePkg(pkg);
    else console.log('[dry-run] would update package.json version to', ver);
    syncLockfile();
    if (!dryRun) {
      sh('git add package.json package-lock.json');
      sh(`git commit -m "chore(release): bump version to ${ver} (v${original} tag already existed)"`);
    } else {
      console.log('[dry-run] would commit package.json + package-lock.json');
    }
  } else {
    console.log(`Version ${ver} is OK; tag v${ver} is not taken yet.`);
  }

  if (localTagExists(`v${ver}`)) {
    const at = shOut(`git rev-parse v${ver}^{}`).slice(0, 7);
    const head = shOut('git rev-parse HEAD').slice(0, 7);
    if (at !== head) {
      throw new Error(`Local tag v${ver} exists but points to ${at}, not HEAD (${head}). Delete or move the tag first.`);
    }
    console.log(`Local tag v${ver} already at HEAD; skipping git tag.`);
  } else {
    if (!dryRun) sh(`git tag v${ver}`);
    else console.log(`[dry-run] would run: git tag v${ver}`);
  }

  const branch = shOut('git branch --show-current');
  if (!branch) throw new Error('Detached HEAD; checkout a branch before releasing.');

  if (!dryRun) {
    sh(`git push origin ${branch}`);
    sh(`git push origin v${ver}`);
  } else {
    console.log(`[dry-run] would run: git push origin ${branch}`);
    console.log(`[dry-run] would run: git push origin v${ver}`);
  }

  console.log(`Done. Release tag: v${ver}`);
}

main();
