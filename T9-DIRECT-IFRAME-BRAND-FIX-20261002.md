# T9 站內遊玩修正

- T9 不再經 MATRIX 同源 HTTP 代理載入。
- 仍然在 MATRIX 程式內 iframe 顯示，但 iframe src 直接使用 TZ 每次取得的官方 T9 授權 URL。
- 因此 T9 自己的 `/api/Lobby/login`、資源載入、Cookie、Origin、WebSocket 全部維持原站行為，不會再被 proxy 改寫後卡在 Login。
- 背景 T9 relay 仍獨立運作，繼續提供牌路/桌台/AI/懸浮資料。
- 所有 MatrixMark 在 MV/T9 平台時顯示 `T9`，不再顯示 `MV`，包含右下角懸浮球。
