import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const installRoot = path.join(root, '.chrome');
const bundledChrome = path.join(installRoot, 'opt', 'google', 'chrome', 'google-chrome');
const systemCandidates = [
  process.env.DG_CHROME_PATH,
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const existsExecutable = (p) => {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
};

if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.log(`[DG Chromium] skip install on ${process.platform}/${process.arch}`);
  process.exit(0);
}

if (systemCandidates.some(existsExecutable)) {
  console.log('[DG Chromium] system Chrome/Chromium already available; download skipped');
  process.exit(0);
}

if (existsExecutable(bundledChrome)) {
  console.log('[DG Chromium] cached Chrome already available');
  process.exit(0);
}

fs.mkdirSync(installRoot, { recursive: true });
const debPath = path.join(installRoot, 'google-chrome-stable_current_amd64.deb');
const url = process.env.DG_CHROME_DOWNLOAD_URL || 'https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb';

console.log(`[DG Chromium] downloading Chrome: ${url}`);
const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
if (!response.ok || !response.body) throw new Error(`Chrome download failed: HTTP ${response.status}`);
await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(debPath));

let extracted = false;
const dpkg = spawnSync('dpkg-deb', ['-x', debPath, installRoot], { stdio: 'inherit' });
if (dpkg.status === 0) extracted = true;

if (!extracted) {
  const temp = path.join(installRoot, '.deb-unpack');
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true });
  const ar = spawnSync('ar', ['x', debPath], { cwd: temp, stdio: 'inherit' });
  if (ar.status !== 0) throw new Error('Chrome package extraction failed: dpkg-deb/ar unavailable');
  const dataArchive = fs.readdirSync(temp).find((name) => /^data\.tar\./.test(name));
  if (!dataArchive) throw new Error('Chrome package extraction failed: data archive missing');
  const tar = spawnSync('tar', ['-xf', path.join(temp, dataArchive), '-C', installRoot], { stdio: 'inherit' });
  if (tar.status !== 0) throw new Error('Chrome package extraction failed: tar failed');
  extracted = true;
  fs.rmSync(temp, { recursive: true, force: true });
}

try { fs.chmodSync(bundledChrome, 0o755); } catch {}
fs.rmSync(debPath, { force: true });

if (!existsExecutable(bundledChrome)) throw new Error(`Chrome executable not found after extraction: ${bundledChrome}`);
console.log(`[DG Chromium] installed: ${bundledChrome}`);
