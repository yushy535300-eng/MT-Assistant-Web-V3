# T9 可連線代理修正

這版修正一個之前漏掉的情況：

T9 在 iframe 代理環境內，如果前端用：
- `location.origin + "/api/Lobby/login"`
- `wss://目前頁面網域/api/baccarat/...`

組網址，會得到 MATRIX 自己的網域，而不是 g.t9gaming.fun。

現在：
- T9 HTTP 若是「目前 MATRIX origin + 非 proxy 自己路徑」，會還原到 g.t9gaming.fun。
- T9 WebSocket 若是「目前 MATRIX host + /api/...」，會還原成
  `wss://g.t9gaming.fun/api/...` 再經既有 WS proxy。
- 不新增 watchdog。
- 保留 persistent 單登入：TZ 登入後建立一次 T9；進入 T9 只顯示；回牌路只隱藏。
