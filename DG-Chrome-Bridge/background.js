const DEFAULT_BACKEND = "https://mt-assistant-web-v3.onrender.com";

async function getBackend() {
  try {
    const v = await chrome.storage.local.get("mtBackendOrigin");
    return String(v.mtBackendOrigin || DEFAULT_BACKEND).replace(/\/$/, "");
  } catch { return DEFAULT_BACKEND; }
}
async function post(path, body) {
  const base = await getBackend();
  try {
    await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store"
    });
  } catch {}
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "set_backend") {
    try {
      const u = new URL(String(msg.origin || ""));
      if (u.protocol === "https:" || /^(?:localhost|127\.0\.0\.1)$/.test(u.hostname)) {
        chrome.storage.local.set({ mtBackendOrigin: u.origin });
      }
    } catch {}
    sendResponse?.({ ok: true });
    return;
  }
  if (msg.type === "frames") {
    void post("/api/dg/bridge/frames", { token: String(msg.token || ""), frames: Array.isArray(msg.frames) ? msg.frames : [] });
    sendResponse?.({ ok: true });
    return true;
  }
  if (msg.type === "status") {
    void post("/api/dg/bridge/status", { token: String(msg.token || ""), state: String(msg.state || ""), pageUrl: String(msg.pageUrl || "") });
    sendResponse?.({ ok: true });
    return true;
  }
});
