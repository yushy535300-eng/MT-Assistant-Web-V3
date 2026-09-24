const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mtDesktop", {
  isDesktop: true,
  getSettings: () => ipcRenderer.invoke("mt-desktop-get-settings"),
  setSettings: (partial) => ipcRenderer.invoke("mt-desktop-set-settings", partial),
  openSettings: () => ipcRenderer.invoke("mt-desktop-open-settings"),
  clearCache: () => ipcRenderer.invoke("mt-desktop-clear-cache"),
  uninstall: () => ipcRenderer.invoke("mt-desktop-uninstall"),
  onSettingsChanged: (cb) => {
    const handler = (_event, next) => {
      try {
        cb(next);
      } catch {}
    };
    ipcRenderer.on("mt-desktop-settings-changed", handler);
    return () => ipcRenderer.removeListener("mt-desktop-settings-changed", handler);
  },
});
