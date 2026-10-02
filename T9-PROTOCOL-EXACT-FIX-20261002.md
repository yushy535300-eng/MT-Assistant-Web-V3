# T9 protocol exact fix

- Use Lobby `ConnectId` exactly as returned.
- Do not append MemberId again.
- Do not `encodeURIComponent` the leading `/`.
- WebSocket URL: `wss://g.t9gaming.fun/api/baccarat` + `ConnectId`.
- Lobby `SerialNumber` is now a 10-character session serial.
- Removed Node `ws.ping()`; keep only T9 application `SyncTime` cadence.
- `SyncTime` is sent immediately after Login; `SyncBalance` follows shortly after.
- Added T9 baccarat status handling for 100-112.
- HTTP 200 during websocket handshake is reported explicitly as a path/upgrade failure.
