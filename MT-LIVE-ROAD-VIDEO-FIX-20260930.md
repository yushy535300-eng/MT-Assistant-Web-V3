# MT LIVE 牌路同步 + 視訊開關修正

- BAV01_LIVE / BAV02_LIVE / BAV03_LIVE / BAV03A_LIVE：
  - 牌路、莊閒和統計、shoe、round、倒數跟對應主桌同步。
  - dealer name/photo/id/nation/stream 仍使用 LIVE 桌自己的資料，不互相覆蓋。
- show_win、wait/end、完整 tables/tablesvg snapshot 都會重新同步主桌 -> LIVE 牌路。
- 視訊只在使用者手動開啟該桌視訊時播放。
- 沒有 dealerPhoto 時不再自動啟動 live stream。
