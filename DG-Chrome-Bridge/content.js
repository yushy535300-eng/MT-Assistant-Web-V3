(() => {
  const isAssistant = /\.onrender\.com$/i.test(location.hostname) || location.hostname === "localhost";
  const isDg = String(location.pathname || "").toLowerCase().includes("/ddnewpc/");

  if (isAssistant && window.top === window) {
    const announce = () => {
      try { window.postMessage({ type: "MT_DG_BRIDGE_READY", version: "1.0.0" }, "*"); } catch {}
      try { chrome.runtime.sendMessage({ type: "set_backend", origin: location.origin }); } catch {}
    };
    window.addEventListener("message", e => {
      if (e.source === window && e.data?.type === "MT_DG_BRIDGE_PING") announce();
    });
    announce();
    setInterval(announce, 2500);
  }

  if (!isDg) return;
  const token = new URL(location.href).searchParams.get("token") || "";
  if (!token) return;
  let queue = [];
  let timer = 0;

  const toBase64 = buffer => {
    const bytes = new Uint8Array(buffer);
    let out = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) out += String.fromCharCode(...bytes.subarray(i, i + step));
    return btoa(out);
  };
  const flush = () => {
    timer = 0;
    if (!queue.length) return;
    const frames = queue.splice(0, 64);
    try { chrome.runtime.sendMessage({ type: "frames", token, frames, pageUrl: location.href }); } catch {}
    if (queue.length) timer = setTimeout(flush, 20);
  };
  const status = state => {
    try { chrome.runtime.sendMessage({ type: "status", token, state, pageUrl: location.href }); } catch {}
  };

  window.addEventListener("message", e => {
    if (e.source !== window) return;
    const m = e.data;
    if (!m || m.__MT_DG_BRIDGE__ !== true) return;
    if (m.type === "frame" && m.buffer instanceof ArrayBuffer) {
      try { queue.push(toBase64(m.buffer)); } catch { return; }
      if (!timer) timer = setTimeout(flush, 20);
    } else if (m.type === "open" || m.type === "close" || m.type === "error") {
      status(m.type);
    }
  });
})();
