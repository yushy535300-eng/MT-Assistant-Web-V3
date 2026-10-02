# T9 Login API 根相對路徑修正

問題：
- T9 主畫面已經正確載入，但遊戲前端呼叫 `/api/Lobby/login`。
- 在同源 iframe 代理下，這個 root-relative URL 會落到 MATRIX 自己的網域。
- 因此 T9 取得 Login 資料失敗，畫面顯示：
  `請求資料失敗，請稍後再試(Login)`。

修正：
- 只針對 T9/MV。
- `/api/Lobby/login`、`/api/Lobby/...` 等 root-relative T9 請求會改寫為：
  `/api/ext/host/g.t9gaming.fun/api/Lobby/...`
- 最終由 server proxy 轉送回真正的 `https://g.t9gaming.fun/...`
- MT / DG / SA 不變。
