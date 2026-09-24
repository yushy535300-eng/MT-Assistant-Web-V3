const { app, BrowserWindow, shell, ipcMain, globalShortcut, dialog, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");
const crypto = require("crypto");
const { spawn } = require("child_process");

/** Production site on Render — desktop is a native shell around this URL. */
const APP_URL =
  process.env.MT_APP_URL || "https://mt-assistant-web-v3.onrender.com/";

const isPackaged = app.isPackaged;

const DEFAULT_SETTINGS = {
  displayMode: "fullscreen", // "fullscreen" | "windowed"
  width: 1440,
  height: 900,
  x: null,
  y: null,
  rememberPosition: true,
  alwaysOnTop: false,
  zoomFactor: 1,
  openAtLogin: false,
};

function resourcePath(...parts) {
  if (isPackaged) return path.join(process.resourcesPath, ...parts);
  return path.join(__dirname, ...parts);
}

function bundledAppPath(...parts) {
  if (isPackaged) return path.join(app.getAppPath(), ...parts);
  return path.join(__dirname, ...parts);
}

function iconPath() {
  const ico = resourcePath("icon.ico");
  if (fs.existsSync(ico)) return ico;
  const png = resourcePath("icon.png");
  if (fs.existsSync(png)) return png;
  const localIco = path.join(__dirname, "build", "icon.ico");
  if (fs.existsSync(localIco)) return localIco;
  return undefined;
}

function dataDir() {
  return path.join(app.getPath("userData"), "secure");
}

function settingsPlainPath() {
  return path.join(app.getPath("userData"), "mt-desktop-settings.json");
}

function settingsEncPath() {
  return path.join(dataDir(), "settings.enc");
}

function vaultEncPath() {
  return path.join(dataDir(), "vault.enc");
}

/** Machine-bound fallback key when OS safeStorage is unavailable. */
function fallbackKey() {
  const seed = [
    os.hostname(),
    os.userInfo().username,
    app.getPath("userData"),
    "mt-assistant-desktop-v1",
  ].join("|");
  return crypto.createHash("sha256").update(seed).digest();
}

function encryptBytes(plainUtf8) {
  if (safeStorage.isEncryptionAvailable()) {
    return Buffer.concat([
      Buffer.from("SS1\0"),
      safeStorage.encryptString(plainUtf8),
    ]);
  }
  const key = fallbackKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plainUtf8, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("AES\0"), iv, tag, enc]);
}

function decryptBytes(buf) {
  if (!buf || buf.length < 4) throw new Error("empty");
  const magic = buf.subarray(0, 4).toString("binary");
  if (magic === "SS1\0") {
    return safeStorage.decryptString(buf.subarray(4));
  }
  if (magic === "AES\0") {
    const iv = buf.subarray(4, 16);
    const tag = buf.subarray(16, 32);
    const enc = buf.subarray(32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", fallbackKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  }
  return buf.toString("utf8");
}

function writeEncryptedJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = encryptBytes(JSON.stringify(obj));
  fs.writeFileSync(filePath, payload);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {}
}

function readEncryptedJson(filePath) {
  const buf = fs.readFileSync(filePath);
  return JSON.parse(decryptBytes(buf));
}

function clampZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.75, Math.max(0.75, Math.round(n * 100) / 100));
}

function normalizeSettings(raw = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    width: Math.max(1024, Math.min(3840, Number(raw.width) || DEFAULT_SETTINGS.width)),
    height: Math.max(640, Math.min(2160, Number(raw.height) || DEFAULT_SETTINGS.height)),
    x: raw.x == null || raw.x === "" ? null : Number(raw.x),
    y: raw.y == null || raw.y === "" ? null : Number(raw.y),
    displayMode: raw.displayMode === "windowed" ? "windowed" : "fullscreen",
    rememberPosition: raw.rememberPosition !== false,
    alwaysOnTop: !!raw.alwaysOnTop,
    zoomFactor: clampZoom(raw.zoomFactor ?? DEFAULT_SETTINGS.zoomFactor),
    openAtLogin: !!raw.openAtLogin,
  };
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsEncPath())) {
      return normalizeSettings(readEncryptedJson(settingsEncPath()));
    }
  } catch (err) {
    console.warn("[desktop] encrypted settings read failed", err?.message || err);
  }
  // Migrate legacy plaintext settings → encrypted vault.
  try {
    if (fs.existsSync(settingsPlainPath())) {
      const raw = JSON.parse(fs.readFileSync(settingsPlainPath(), "utf8"));
      const next = normalizeSettings(raw);
      saveSettings(next);
      try {
        fs.unlinkSync(settingsPlainPath());
      } catch {}
      return next;
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(next) {
  try {
    writeEncryptedJson(settingsEncPath(), next);
    try {
      if (fs.existsSync(settingsPlainPath())) fs.unlinkSync(settingsPlainPath());
    } catch {}
  } catch (err) {
    console.warn("[desktop] save settings failed", err?.message || err);
  }
}

function loadVault() {
  try {
    if (fs.existsSync(vaultEncPath())) return readEncryptedJson(vaultEncPath());
  } catch {}
  return {};
}

function saveVault(vault) {
  try {
    writeEncryptedJson(vaultEncPath(), vault || {});
  } catch (err) {
    console.warn("[desktop] save vault failed", err?.message || err);
  }
}

let mainWindow = null;
let settingsWindow = null;
let settings = { ...DEFAULT_SETTINGS };
let persistTimer = null;

function broadcastSettings() {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send("mt-desktop-settings-changed", settings);
    } catch {}
  }
}

function applyOpenAtLogin() {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!settings.openAtLogin,
      path: process.execPath,
      args: [],
    });
  } catch (err) {
    console.warn("[desktop] openAtLogin failed", err?.message || err);
  }
}

function applyZoom() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.setZoomFactor(settings.zoomFactor);
  } catch {}
}

function applyAlwaysOnTop() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setAlwaysOnTop(!!settings.alwaysOnTop, "floating");
}

function applyDisplaySettings(opts = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return settings;
  const center = !!opts.center || !!opts.forceCenter;
  applyAlwaysOnTop();
  applyZoom();

  if (settings.displayMode === "fullscreen") {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setFullScreen(true);
  } else {
    mainWindow.setFullScreen(false);
    const { width, height } = settings;
    const usePos =
      settings.rememberPosition &&
      Number.isFinite(settings.x) &&
      Number.isFinite(settings.y) &&
      !center;
    if (usePos) {
      mainWindow.setBounds({
        x: Math.round(settings.x),
        y: Math.round(settings.y),
        width,
        height,
      });
    } else {
      mainWindow.setSize(width, height, false);
      if (center) mainWindow.center();
    }
    mainWindow.setMenuBarVisibility(false);
  }
  return settings;
}

function persistGeometrySoon() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isFullScreen() || mainWindow.isMaximized()) return;
  if (settings.displayMode !== "windowed") return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [width, height] = mainWindow.getSize();
    const [x, y] = mainWindow.getPosition();
    settings.width = width;
    settings.height = height;
    if (settings.rememberPosition) {
      settings.x = x;
      settings.y = y;
    }
    saveSettings(settings);
  }, 250);
}

function toggleDisplayMode() {
  settings.displayMode =
    settings.displayMode === "fullscreen" ? "windowed" : "fullscreen";
  saveSettings(settings);
  applyDisplaySettings({
    forceCenter:
      settings.displayMode === "windowed" &&
      !(settings.rememberPosition && Number.isFinite(settings.x)),
  });
  broadcastSettings();
  return settings;
}

function ensureDesktopShortcut() {
  if (process.platform !== "win32" || !isPackaged) return;
  try {
    const desktop = path.join(os.homedir(), "Desktop");
    const lnkPath = path.join(desktop, "MT Assistant.lnk");
    const target = process.execPath;
    const workDir = path.dirname(target);
    // Prefer packaged phone-logo ico so Windows desktop shows the mobile M icon.
    const iconCandidates = [
      resourcePath("icon.ico"),
      path.join(workDir, "resources", "icon.ico"),
      path.join(process.resourcesPath || "", "icon.ico"),
      target,
    ];
    const icon =
      iconCandidates.find((p) => p && fs.existsSync(p)) || target;
    const ps = `
$ErrorActionPreference = 'Stop'
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut(${JSON.stringify(lnkPath)})
$s.TargetPath = ${JSON.stringify(target)}
$s.WorkingDirectory = ${JSON.stringify(workDir)}
$s.IconLocation = ${JSON.stringify(icon + ",0")}
$s.Description = 'MT Assistant'
$s.WindowStyle = 3
$s.Save()
`;
    spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { windowsHide: true, detached: true, stdio: "ignore" },
    ).unref?.();
  } catch (err) {
    console.warn("[desktop] shortcut failed", err?.message || err);
  }
}

function waitForRender(url, { attempts = 40, intervalMs = 2500 } = {}) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tryOnce = () => {
      n += 1;
      const req = https.get(
        url,
        { timeout: 12000, headers: { Accept: "text/html" } },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
            resolve(true);
            return;
          }
          if (n >= attempts) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          setTimeout(tryOnce, intervalMs);
        },
      );
      req.on("timeout", () => {
        req.destroy();
        if (n >= attempts) {
          reject(new Error("timeout"));
          return;
        }
        setTimeout(tryOnce, intervalMs);
      });
      req.on("error", (err) => {
        if (n >= attempts) {
          reject(err);
          return;
        }
        setTimeout(tryOnce, intervalMs);
      });
    };
    tryOnce();
  });
}

function showFailPage(err) {
  const msg = String(err?.message || err);
  void mainWindow.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<body style="margin:0;background:#070d15;color:#edf6ff;font-family:Segoe UI,Microsoft JhengHei,sans-serif;display:grid;place-items:center;height:100vh"><div style="max-width:560px;padding:24px;text-align:center"><h1>連線失敗</h1><p>無法開啟你的 Render 網站</p><p style="opacity:.8;word-break:break-all">${APP_URL}</p><p style="opacity:.7">${msg}</p><p>請確認網路後再開一次（Render 休眠醒來約需數十秒）。</p></div></body>`,
      ),
  );
}

function findUninstaller() {
  const candidates = [];
  try {
    candidates.push(
      path.join(path.dirname(process.execPath), "Uninstall MT Assistant.exe"),
    );
  } catch {}
  try {
    const localApp = process.env.LOCALAPPDATA || "";
    if (localApp) {
      candidates.push(
        path.join(localApp, "Programs", "MT Assistant", "Uninstall MT Assistant.exe"),
      );
      candidates.push(
        path.join(
          localApp,
          "Programs",
          "mt-assistant-desktop",
          "Uninstall MT Assistant.exe",
        ),
      );
    }
  } catch {}
  for (const file of candidates) {
    if (file && fs.existsSync(file)) return file;
  }
  return null;
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  const icon = iconPath();
  settingsWindow = new BrowserWindow({
    width: 540,
    height: 760,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    minWidth: 480,
    minHeight: 640,
    title: "MT Assistant 設定",
    backgroundColor: "#0b1520",
    autoHideMenuBar: true,
    parent: mainWindow || undefined,
    modal: false,
    show: false,
    icon,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  void settingsWindow.loadFile(bundledAppPath("settings.html"));
  settingsWindow.once("ready-to-show", () => {
    settingsWindow.show();
    settingsWindow.focus();
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function injectSettingsButton() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const script = `(() => {
    if (window.__mtDesktopSettingsInjected) return true;
    window.__mtDesktopSettingsInjected = true;

    function openSettings() {
      if (window.mtDesktop && window.mtDesktop.openSettings) {
        window.mtDesktop.openSettings();
      }
    }

    function makeBtn(id) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = id;
      btn.innerHTML = '<span style="font-size:14px;line-height:1">⚙</span><span>設定</span>';
      btn.setAttribute("aria-label", "程式設定");
      btn.style.cssText = [
        "height:34px",
        "padding:0 10px",
        "border-radius:7px",
        "background:#102A3D",
        "color:#fff",
        "font-size:10px",
        "font-weight:800",
        "border:1px solid #3D6682",
        "cursor:pointer",
        "display:inline-flex",
        "align-items:center",
        "gap:5px",
        "flex-shrink:0",
        "font-family:Segoe UI,Microsoft JhengHei,sans-serif",
        "z-index:2147483646",
        "pointer-events:auto",
      ].join(";");
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openSettings();
      });
      return btn;
    }

    // Only the fixed top-right 設定 button — never inject into the header row
    // next to 連線 (that overlaps and duplicates).
    function ensureFab() {
      // Remove any old header-injected duplicates from previous builds.
      document.querySelectorAll("#mt-desktop-settings-btn").forEach((el) => el.remove());
      let fab = document.getElementById("mt-desktop-settings-fab");
      if (!fab) {
        fab = makeBtn("mt-desktop-settings-fab");
        fab.style.position = "fixed";
        fab.style.top = "10px";
        fab.style.right = "10px";
        fab.style.boxShadow = "0 8px 24px rgba(0,0,0,.45)";
        (document.body || document.documentElement).appendChild(fab);
      }
      return fab;
    }

    ensureFab();
    const obs = new MutationObserver(function () {
      ensureFab();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("keydown", function (e) {
      if (e.key === "F11") e.preventDefault();
    });
    return true;
  })();`;
  void mainWindow.webContents.executeJavaScript(script, true).catch(() => {});
}

function createWindow() {
  const icon = iconPath();
  const startFullscreen = settings.displayMode === "fullscreen";
  const winOpts = {
    width: settings.width,
    height: settings.height,
    minWidth: 1024,
    minHeight: 640,
    fullscreen: startFullscreen,
    title: "MT Assistant",
    backgroundColor: "#070d15",
    autoHideMenuBar: true,
    show: false,
    icon,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };
  if (
    !startFullscreen &&
    settings.rememberPosition &&
    Number.isFinite(settings.x) &&
    Number.isFinite(settings.y)
  ) {
    winOpts.x = Math.round(settings.x);
    winOpts.y = Math.round(settings.y);
  }

  mainWindow = new BrowserWindow(winOpts);
  mainWindow.setMenuBarVisibility(false);
  applyAlwaysOnTop();

  const splash = bundledAppPath("splash.html");
  if (fs.existsSync(splash)) {
    mainWindow.loadFile(splash);
  } else {
    mainWindow.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          "<body style='margin:0;background:#070d15;color:#edf6ff;display:grid;place-items:center;height:100vh;font-family:Segoe UI,Microsoft JhengHei,sans-serif'><div style='text-align:center'><h1>MT Assistant</h1><p>載入中…</p></div></body>",
        ),
    );
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    applyDisplaySettings({
      forceCenter:
        !startFullscreen &&
        !(settings.rememberPosition && Number.isFinite(settings.x)),
    });
  });

  mainWindow.webContents.on("did-finish-load", () => {
    applyZoom();
    const url = mainWindow.webContents.getURL();
    if (url.startsWith("http")) injectSettingsButton();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const dest = new URL(url);
      const appHost = new URL(APP_URL).hostname;
      if (dest.hostname === appHost || dest.hostname.endsWith(".onrender.com")) {
        return { action: "allow" };
      }
    } catch {}
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("resize", persistGeometrySoon);
  mainWindow.on("move", persistGeometrySoon);

  mainWindow.on("enter-full-screen", () => {
    settings.displayMode = "fullscreen";
    saveSettings(settings);
    broadcastSettings();
  });

  mainWindow.on("leave-full-screen", () => {
    settings.displayMode = "windowed";
    saveSettings(settings);
    broadcastSettings();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const go = async () => {
    try {
      await waitForRender(APP_URL);
      await mainWindow.loadURL(APP_URL);
      applyDisplaySettings({
        forceCenter:
          settings.displayMode === "windowed" &&
          !(settings.rememberPosition && Number.isFinite(settings.x)),
      });
    } catch (err) {
      try {
        await mainWindow.loadURL(APP_URL);
        applyDisplaySettings({
          forceCenter:
            settings.displayMode === "windowed" &&
            !(settings.rememberPosition && Number.isFinite(settings.x)),
        });
      } catch (err2) {
        showFailPage(err2 || err);
      }
    }
  };
  setTimeout(() => {
    void go();
  }, 300);
}

function mergeSettings(partial = {}) {
  if (partial.displayMode === "fullscreen" || partial.displayMode === "windowed") {
    settings.displayMode = partial.displayMode;
  }
  if (partial.width != null) {
    settings.width = Math.max(1024, Math.min(3840, Number(partial.width) || settings.width));
  }
  if (partial.height != null) {
    settings.height = Math.max(640, Math.min(2160, Number(partial.height) || settings.height));
  }
  if (partial.x != null) settings.x = Number(partial.x);
  if (partial.y != null) settings.y = Number(partial.y);
  if (typeof partial.rememberPosition === "boolean") {
    settings.rememberPosition = partial.rememberPosition;
  }
  if (typeof partial.alwaysOnTop === "boolean") {
    settings.alwaysOnTop = partial.alwaysOnTop;
  }
  if (partial.zoomFactor != null) {
    settings.zoomFactor = clampZoom(partial.zoomFactor);
  }
  if (typeof partial.openAtLogin === "boolean") {
    settings.openAtLogin = partial.openAtLogin;
    applyOpenAtLogin();
  }
  saveSettings(settings);
  applyDisplaySettings({
    center: !!partial.center,
    forceCenter: !!partial.center,
  });
  broadcastSettings();
  return { ...settings };
}

function registerIpc() {
  ipcMain.handle("mt-desktop-get-settings", () => ({ ...settings }));

  ipcMain.handle("mt-desktop-set-settings", (_event, partial = {}) =>
    mergeSettings(partial),
  );

  ipcMain.handle("mt-desktop-open-settings", () => {
    openSettingsWindow();
    return { ok: true };
  });

  ipcMain.handle("mt-desktop-clear-cache", async () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const ses = mainWindow.webContents.session;
        await ses.clearCache();
        await ses.clearStorageData({
          storages: ["appcache", "serviceworkers", "cachestorage"],
        });
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle("mt-desktop-vault-get", () => loadVault());
  ipcMain.handle("mt-desktop-vault-set", (_event, partial = {}) => {
    const next = { ...loadVault(), ...(partial || {}) };
    saveVault(next);
    return next;
  });

  ipcMain.handle("mt-desktop-uninstall", async () => {
    const uninstaller = findUninstaller();
    if (!uninstaller) {
      return {
        ok: false,
        error:
          "找不到卸載程式。請改用 Windows「設定 → 應用程式 → 已安裝的應用程式」卸載 MT Assistant。",
      };
    }
    const result = await dialog.showMessageBox(settingsWindow || mainWindow, {
      type: "warning",
      buttons: ["取消", "開啟卸載"],
      defaultId: 1,
      cancelId: 0,
      title: "卸載 MT Assistant",
      message: "確定要卸載 MT Assistant？",
      detail: "會開啟 Windows 解除安裝精靈，從這台電腦移除此程式。",
    });
    if (result.response !== 1) return { ok: false, error: "已取消" };
    const opened = await shell.openPath(uninstaller);
    if (opened) return { ok: false, error: opened };
    return { ok: true };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    settings = loadSettings();
    applyOpenAtLogin();
    registerIpc();
    ensureDesktopShortcut();
    createWindow();

    try {
      globalShortcut.register("F11", () => {
        toggleDisplayMode();
      });
      globalShortcut.register("CommandOrControl+0", () => {
        mergeSettings({ zoomFactor: 1 });
      });
      globalShortcut.register("CommandOrControl+=", () => {
        mergeSettings({ zoomFactor: settings.zoomFactor + 0.1 });
      });
      globalShortcut.register("CommandOrControl+-", () => {
        mergeSettings({ zoomFactor: settings.zoomFactor - 0.1 });
      });
    } catch (err) {
      console.warn("[desktop] shortcut failed", err?.message || err);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("will-quit", () => {
    try {
      globalShortcut.unregisterAll();
    } catch {}
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
