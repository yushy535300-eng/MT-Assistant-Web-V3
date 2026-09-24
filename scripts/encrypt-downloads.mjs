#!/usr/bin/env node
/**
 * AES-256 encrypt download artifacts so stolen copies can't be opened without password.
 * Installer/exe inside still run normally after the owner extracts them.
 *
 * Password: env MT_DOWNLOAD_PASSWORD or default (also written to artifacts/DOWNLOAD.txt).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const password = process.env.MT_DOWNLOAD_PASSWORD || "MT#Assist@2026";

const pairs = [
  {
    src: path.join(root, "desktop/release/MT-Assistant-Setup-1.0.5.exe"),
    alt: path.join(root, "web-dist/MT-Assistant-Setup.exe"),
    outName: "MT-Assistant-Setup.zip",
    innerName: "MT-Assistant-Setup.exe",
  },
  {
    src: path.join(root, "web-dist/mt-assistant-github.zip"),
    alt: path.join(root, "mt_assistant_for_github.zip"),
    outName: "mt-assistant-github.encrypted.zip",
    innerName: "mt-assistant-github.zip",
  },
];

function findSrc(p) {
  if (fs.existsSync(p.src) && fs.statSync(p.src).size > 1000) return p.src;
  if (fs.existsSync(p.alt) && fs.statSync(p.alt).size > 1000) return p.alt;
  // newest Setup in release/
  const release = path.join(root, "desktop/release");
  if (fs.existsSync(release) && p.outName.includes("Setup")) {
    const exes = fs
      .readdirSync(release)
      .filter((n) => /^MT-Assistant-Setup-.*\.exe$/i.test(n))
      .map((n) => {
        const f = path.join(release, n);
        return { f, m: fs.statSync(f).mtimeMs, s: fs.statSync(f).size };
      })
      .filter((x) => x.s > 5_000_000)
      .sort((a, b) => b.m - a.m);
    if (exes[0]) return exes[0].f;
  }
  return null;
}

function encryptOne(src, outPath, innerName) {
  const tmpDir = path.join(root, ".tmp-encrypt");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const staged = path.join(tmpDir, innerName);
  fs.copyFileSync(src, staged);
  fs.rmSync(outPath, { force: true });
  // -tzip -mem=AES256 : AES encrypted zip readable by Windows Explorer / 7-Zip
  const r = spawnSync(
    "7z",
    ["a", "-tzip", "-mem=AES256", `-p${password}`, "-y", outPath, staged],
    { encoding: "utf8" },
  );
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (r.status !== 0) {
    console.error(r.stdout || "", r.stderr || "");
    throw new Error(`7z failed for ${outPath}`);
  }
  const st = fs.statSync(outPath);
  console.log(`encrypted ${outPath} (${st.size} bytes)`);
}

for (const p of pairs) {
  const src = findSrc(p);
  if (!src) {
    console.warn("skip missing", p.outName);
    continue;
  }
  const outWeb = path.join(root, "web-dist", p.outName);
  const outArt = path.join("/opt/cursor/artifacts", p.outName);
  encryptOne(src, outWeb, p.innerName);
  fs.copyFileSync(outWeb, outArt);
  console.log("copied", outArt);
}

fs.writeFileSync(
  path.join("/opt/cursor/artifacts", "DOWNLOAD.txt"),
  `MT Assistant 下載（AES-256 加密）

解壓密碼（請私下傳給你要給的人，不要公開貼）：
${password}

【電腦安裝版】解壓後得到 Setup.exe，再安裝即可正常使用
https://holds-textbooks-recognized-womens.trycloudflare.com/download/MT-Assistant-Setup.zip

【網頁／原始碼 ZIP】
https://holds-textbooks-recognized-womens.trycloudflare.com/download/mt-assistant-github.encrypted.zip

說明：
- 下載檔加密，被偷走沒密碼解不開
- 你解壓後的 Setup.exe 可正常安裝／執行（連 Render）
- Logo＝手機版金色 M；安裝介面有程式風格側欄
- 牌路主頁右上角固定「設定」按鈕
`,
  "utf8",
);
console.log("password documented in /opt/cursor/artifacts/DOWNLOAD.txt");
