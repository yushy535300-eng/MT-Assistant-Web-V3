(() => {
  if (window.__MT_DG_BRIDGE_HOOKED__) return;
  const path = String(location.pathname || "").toLowerCase();
  if (!path.includes("/ddnewpc/")) return;
  window.__MT_DG_BRIDGE_HOOKED__ = true;

  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket) return;
  const vendorHost = host => /(?:^|\.)(?:kindlestone\.com|taxyss\.com|ywjxi\.com)$/i.test(host || "");

  const emit = (type, wsUrl, payload) => {
    try { window.postMessage({ __MT_DG_BRIDGE__: true, type, wsUrl, ...payload }, "*"); } catch {}
  };
  const emitBinary = async (wsUrl, data) => {
    try {
      let buf;
      if (data instanceof ArrayBuffer) buf = data;
      else if (ArrayBuffer.isView(data)) buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      else if (data instanceof Blob) buf = await data.arrayBuffer();
      else return;
      window.postMessage({ __MT_DG_BRIDGE__: true, type: "frame", wsUrl, buffer: buf }, "*", [buf]);
    } catch {}
  };

  const wrap = new Proxy(NativeWebSocket, {
    construct(Target, args) {
      const ws = Reflect.construct(Target, args, Target);
      let parsed;
      try { parsed = new URL(String(args[0]), location.href); } catch { return ws; }
      if (parsed.protocol !== "wss:" || !vendorHost(parsed.hostname)) return ws;
      const url = parsed.toString();
      ws.addEventListener("open", () => emit("open", url, {}));
      ws.addEventListener("close", () => emit("close", url, {}));
      ws.addEventListener("error", () => emit("error", url, {}));
      ws.addEventListener("message", event => { void emitBinary(url, event.data); });
      return ws;
    }
  });
  try { Object.defineProperty(window, "WebSocket", { value: wrap, configurable: true, writable: true }); }
  catch { try { window.WebSocket = wrap; } catch {} }
})();
