# T9 Socket ID / 授權網址修正

- ConnectId 已包含 `_MemberId` 時直接使用，不再重複拼接。
- ConnectId 未包含時才補 `_MemberId`。
- 修正 `xxx_2123033_2123033` 造成 WebSocket handshake 200 / close 1006。
- 牌路連線中心新增「T9 牌路授權網址（唯讀）」欄位，顯示目前 TZ 取得的 T9 game_url（套用既有遮罩）。
