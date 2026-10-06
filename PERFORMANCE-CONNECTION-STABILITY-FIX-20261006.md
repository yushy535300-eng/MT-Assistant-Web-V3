# 全流程流暢 / 連線穩定修正 2026-10-06

本版只改效能與連線管理，不改遊戲玩法、牌路演算法、莊閒推薦方向或 UI 功能。

- 全平台 reconnect busy 使用 finally 保證解鎖，避免例外後整頁永久卡在 busy。
- DG / SA 桌資料加入 unchanged merge，沒有實際變化不觸發整頁 React render。
- T9 table SSE 以 90ms 批次合併並去重，避免大量 SyncTableStatus 封包每包都推一次整個桌表。
- T9 公告偵測不再 attributes+subtree 無限掃描；改為 childList + debounce，最多啟動期執行 18 次後停止。
- 背景 T9 iframe 保留 session 但 visibility:hidden / opacity:0，降低瀏覽器 paint/composite 負擔。
- SA 缺牌路 init 背景 retry 由 12 秒降壓為 20 秒，不影響已同步桌牌路與即時開獎。

目標：登入、主頁、切平台、進遊戲、懸浮操作與即時牌路更新不再被背景重連/渲染風暴拖慢。
