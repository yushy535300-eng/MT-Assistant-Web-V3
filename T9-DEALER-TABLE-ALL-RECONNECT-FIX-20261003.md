# T9 荷官 / 桌號 / 全平台重新連線修正

本版以 MT-Assistant-T9-CONNECTABLE-PROXY-FIX-20261002 為基準。

## T9 桌號
- TableId 仍作為唯一資料追蹤鍵。
- 顯示桌號優先選真正 `BG_###` baccarat table code。
- 已確認目前 `WG13` 實際為 `BG_138`，加入映射驗證。
- 後續 SyncTableStatus 不會把正確桌號洗回錯誤 display name。

## T9 荷官
荷官名稱與圖片會從多種 T9 metadata 欄位合併：
- DealerName
- Dealer.Name / Dealer.DealerName
- DealerInfo.Name / DealerInfo.DealerName
- DealerData.Name / DealerData.DealerName
- DealerPhotoUrl / PhotoUrl / Photo 等

只有新封包真的有資料才更新；純牌路封包不會把原本荷官資料清掉。
主頁與懸浮共用同一份修正後 T9 table state。

## 重新連線
右上角連線中心「重新連線」固定一次執行：
- MT
- DG
- SA
- T9

T9 對使用者操作與其他平台一致；內部先清掉舊 single-session，
再建立一個新的 persistent T9 session，避免舊新 session 同時登入。
其中一個平台失敗不阻止其他平台完成重連。
