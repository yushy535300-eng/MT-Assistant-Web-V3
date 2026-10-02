# T9 穩定共享連線修正

這版不再改 T9 Login ownership，也不加入會誤殺正常 Session 的 watchdog。

固定規則：
- T9 官方 persistent iframe 是唯一登入持有者。
- 進入 T9 只顯示；回牌路只隱藏。
- 主頁 / 懸浮只讀 relay 的同一份共享 tables。
- SSE 短暫錯誤不等於 T9 登出，不再顯示「即時通道中斷」並清資料。
- EventSource 自己重連。
- 同時每 2 秒讀 `/api/t9/snapshot` 當同步備援。
- 有 bridge / SSE subscriber / open socket 時，3 分鐘 idle sweeper 禁止清掉 T9 relay。
- 一次 snapshot 失敗只保留舊資料，不重建、不搶登。

目的：
正常 T9 Session 不會被 MATRIX 自己的同步層誤判後殺掉；
遊戲、主頁牌路、懸浮維持同一份即時狀態。
