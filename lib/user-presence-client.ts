export function connectUserPresence(sessionId: string, getRunning: () => boolean) {
  let stopped = false;
  let authRejected = false;
  let socket: WebSocket | null = null;
  let authenticated = false;
  let lastRunning: boolean | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let retryMs = 1000;
  function reportState() {
    if (!authenticated || socket?.readyState !== WebSocket.OPEN) return;
    let running = false;
    try { running = getRunning() === true; } catch {}
    if (lastRunning === running) return;
    socket.send(JSON.stringify({ type: 'state', running }));
    lastRunning = running;
  }
  function connect() {
    if (stopped || authRejected || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    const url = new URL('/api/presence/ws', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const current = new WebSocket(url.href);
    socket = current;
    authenticated = false;
    lastRunning = null;
    current.onopen = () => {
      if (stopped || current !== socket) { current.close(); return; }
      current.send(JSON.stringify({ type: 'auth', sessionId }));
    };
    current.onmessage = event => {
      if (current !== socket || stopped) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'authenticated') {
          authenticated = true; retryMs = 1000; reportState();
        }
      } catch {}
    };
    current.onclose = event => {
      if (current !== socket) return;
      socket = null; authenticated = false;
      // Invalid/revoked sessions must not reconnect indefinitely.
      if(event.code===1008||event.code===4001||event.code===4401){authRejected=true;return;}
      if(stopped)return;
      reconnectTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(15000, retryMs * 2);
    };
    current.onerror = () => { /* Socket close handles bounded reconnect timing; no credential logs. */ };
  }
  const statusTimer = setInterval(reportState, 500);
  const onVisible = () => {
    if (document.visibilityState === 'visible') { connect(); reportState(); }
  };
  const onOnline = () => connect();
  const onPageHide = () => {
    authenticated = false;
    socket?.close(1000, 'page-hidden');
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisible);
  connect();
  return {
    dispose() {
      stopped = true; authenticated = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(statusTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisible);
      socket?.close(1000, 'signed-out');
      socket = null;
    },
  };
}
