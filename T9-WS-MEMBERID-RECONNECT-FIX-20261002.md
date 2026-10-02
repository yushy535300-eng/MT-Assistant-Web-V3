# T9 即時通道修正

本版修正：
1. WebSocket 路徑由 `/api/baccarat/<ConnectId>` 改為
   `/api/baccarat/<ConnectId>_<MemberId>`，與 T9 真實瀏覽器連線一致。
2. Lobby login 缺少 ConnectId / MemberId 時直接顯示明確錯誤。
3. WebSocket `error` 後主動 close，避免 runtime 停在壞掉的 OPEN socket。
4. relay 狀態為 `error` / `closed` 時禁止 reuse；按重新連線會：
   - 關閉舊 relay
   - 重新 Lobby login
   - 取得新的 ConnectId / MemberId
   - 建立新的 T9 baccarat WebSocket
5. 啟動失敗時移除壞掉 relay，不會再回 `reused:true,status:error`。
