# T9 WebSocket 握手修正

- Server 改用 `ws` client，可控制實際握手 header。
- 帶入與成功 Chrome request 一致的 `Origin: https://g.t9gaming.fun`。
- 補 User-Agent / Accept-Language / no-cache headers。
- 啟用 permessage-deflate，handshake timeout 12 秒。
- 保留 `ConnectId_MemberId` socket path。
- handshake 非 101 時，連線中心會顯示 HTTP status。
- error 顯示具體 message/code。
- close 顯示 close code / reason。
- error/closed relay 仍禁止 reuse，重新連線會重建 Lobby login 與 socket。
