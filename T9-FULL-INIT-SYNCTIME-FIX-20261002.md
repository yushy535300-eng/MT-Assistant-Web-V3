# T9 完整初始化與桌台同步修正

本版依真實 T9 WebSocket HAR 還原瀏覽器順序：
1. WebSocket 101
2. Login
3. 收到 Login / TableList
4. 立即送 SyncTime(GameType=80001)
5. 立即送 SyncBalance(GameType=80001, AgentId, MemberName)
6. 開始接收 SyncTableStatus / SyncTableInfo / SyncAllRoomCardInfo
7. 每 30 秒送 SyncTime；底層每 20 秒 websocket ping，避免中介層 idle timeout
8. close / reconnect 時清掉 heartbeat，重新跑完整初始化

UI：
- T9 不再顯示「僅直播」
- 跟 MT/DG/SA 一樣顯示：連線中 / 已連線 / 錯誤原因
- 桌數正常由即時 T9 桌台資料決定
