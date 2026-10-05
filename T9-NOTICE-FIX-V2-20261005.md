# T9 公告遮罩修正 V2

- 不再只用完全相等的按鈕文字搜尋。
- 會搜尋 T9 主文件與同源子 iframe。
- 支援巢狀 span/div/button 與文字包含比對。
- 依序觸發 pointerdown / mousedown / click / mouseup，提升 T9 前端框架按鈕被觸發的可靠度。
- 若公告內容頁本身已壞成 Unmatched Route，但外層「確定詳閱注意事項 / 今日不再顯示」仍存在，會在無法正常點擊時只隱藏該公告遮罩，不動 T9 大廳。
- 保留 T9 背景靜音 / 進入恢復聲音、single-session、即時牌路與前面所有修正。
