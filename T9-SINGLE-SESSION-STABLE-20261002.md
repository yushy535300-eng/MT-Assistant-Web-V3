# T9 單工作階段穩定版

- T9 遊戲、主頁牌路、懸浮不再各自登入。
- 進入 T9 前先停止背景 T9 WebSocket。
- 官方 T9 iframe 是唯一 Lobby/login + baccarat WebSocket 擁有者。
- 同源 proxy 鏡像同一條 T9 server->browser WebSocket frame 到 MATRIX relay。
- 主頁多桌、懸浮、AI、V38、奇偶全部讀同一份 relay table state。
- 遊戲期間 relay 不送第二次 Login / SyncTime / SyncBalance。
- 離開遊戲時保留最後桌台快取，取得新的 TZ/T9 授權後恢復背景牌路。
- 不在遊戲/主頁切換時清空 T9 tables，避免畫面歸零或懸浮斷線。
