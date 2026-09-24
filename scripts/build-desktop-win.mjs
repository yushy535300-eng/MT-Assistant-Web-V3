#!/usr/bin/env node
/**
 * Build Windows NSIS installer — thin shell that opens Render cloud app.
 * Usage: node scripts/build-desktop-win.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "desktop");

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    stdio: "inherit",
    env: { ...process.env, ...(opts.env || {}) },
    shell: !!opts.shell,
  });
  if (r.status !== 0) process.exit(r.status || 1);
  return r;
}

fs.mkdirSync(path.join(desktop, "build"), { recursive: true });

// Phone / PWA logo + branded NSIS sidebars.
run("python3", [path.join(desktop, "make-installer-assets.py")]);
fs.copyFileSync(
  path.join(desktop, "build", "icon.png"),
  path.join(desktop, "icon.png"),
);

if (!fs.existsSync(path.join(desktop, "node_modules", "electron"))) {
  run("npm", ["install", "--no-fund", "--no-audit"], {
    cwd: desktop,
    shell: true,
  });
}
run("node", ["make-ico.mjs", "build/icon.png", "build/icon.ico"], {
  cwd: desktop,
});

/** Force-embed phone logo into the Windows .exe (cross-build needs wine + rcedit). */
function forceEmbedExeIcon() {
  const exe = path.join(desktop, "release", "win-unpacked", "MT Assistant.exe");
  const ico = path.join(desktop, "build", "icon.ico");
  if (!fs.existsSync(exe) || !fs.existsSync(ico)) {
    console.warn("skip rcedit: missing exe/ico");
    return;
  }
  const rcedit = path.join(
    os.homedir(),
    ".cache/electron-builder/winCodeSign/winCodeSign-2.6.0/rcedit-x64.exe",
  );
  if (!fs.existsSync(rcedit)) {
    console.warn("skip rcedit: binary not found");
    return;
  }
  console.log("Embedding phone logo into MT Assistant.exe via wine/rcedit…");
  const r = spawnSync(
    "wine",
    [rcedit, exe, "--set-icon", ico],
    { cwd: desktop, encoding: "utf8", env: { ...process.env, WINEDEBUG: "-all" } },
  );
  if (r.status !== 0) {
    console.warn("rcedit failed:", r.stderr || r.stdout);
  } else {
    console.log("rcedit ok — exe icon set to mobile logo");
  }
}

// Pack first (dir), embed icon, then build NSIS from that dir.
run("npx", ["electron-builder", "--win", "dir", "--x64"], {
  cwd: desktop,
  shell: true,
  env: {
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
    WIN_CSC_LINK: "",
  },
});
forceEmbedExeIcon();
run("npx", ["electron-builder", "--win", "nsis", "--x64", "--prepackaged", "release/win-unpacked"], {
  cwd: desktop,
  shell: true,
  env: {
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  },
});

const release = path.join(desktop, "release");
for (const name of fs.readdirSync(release)) {
  if (/Setup.*\.exe$/i.test(name)) {
    console.log("Built:", path.join(release, name));
  }
}
