# T9 永駐單登入工作階段

流程改成：

1. TZ 登入完成
2. 取得一次 T9 授權 URL
3. 建立一個隱藏、常駐的 T9 iframe
4. T9 Lobby/login 只執行一次
5. T9 官方 websocket 持續連線
6. proxy 只鏡像這同一條 websocket 到 MATRIX state
7. 主頁多桌與懸浮都讀同一份 T9 state
8. 按「進入 T9」只把同一個 iframe 移到前景
9. 按「回牌路」只把它移到背景，不 reload、不 logout、不重新授權
10. 只有「重新連線」或登出才會真的重建 T9 session

這版不再於按「進入 T9」時呼叫新的 TZ/T9 login。
