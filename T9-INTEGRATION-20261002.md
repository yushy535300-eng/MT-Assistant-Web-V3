# T9 真人百家樂整合（2026-10-02）

- 原「美女直播」入口改為 T9。
- 使用 TZ `/api/v2/game/T9/login` 每次取得新的 T9 `game_url`，不寫死 customToken。
- 後端以 T9 Lobby/login 換取 Token + ConnectId，連線 `wss://g.t9gaming.fun/api/baccarat/{ConnectId}`。
- WebSocket 採 T9 前端同一套 AES-256-CBC / PKCS7 解碼。
- 已接入 Login / SyncTableInfo / SyncTableStatus / SyncAreaBetInfo / EnterTable 等百家樂即時訊息。
- 同步桌台名稱、荷官名稱/圖片、牌路、倒數、牌面、莊閒和統計、Round、玩家資訊等，轉為既有 TableData 格式。
- T9 桌台可使用原 MT/DG 的多桌牌路、選桌、懸浮、AI、問路、V38/奇偶資料鏈。
- 點「進入 T9」時會重新取得前景的一次性授權 URL，在站內遊玩；背景資料 relay 保持獨立授權持續同步。
- MT / DG / SA 既有流程不修改。
