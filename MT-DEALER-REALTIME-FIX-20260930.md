# MT 荷官即時資訊修正
- 一般桌與 `_LIVE` 桌只用精確 `table_id` 配對。
- 荷官名稱支援 username / realname / nickname 等欄位，忽略 TEST 佔位名稱。
- 荷官照片只接受有效 URL；換荷官而新照片尚未到時，不再顯示上一位荷官。
- MT `/tables` 每 5 秒同步荷官 metadata；資料未變時沿用原 table object，不造成整桌重畫。
- MT 某桌沒有 avatar 時，卡片會用該桌實際 live stream 當畫面 fallback，而不是皇冠空白圖。
- dealer id / nation 一併保存，供換班判斷。
