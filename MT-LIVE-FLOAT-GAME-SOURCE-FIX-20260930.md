# MT LIVE 懸浮牌局來源修正

LIVE 桌只保留「桌台身分 + 荷官」；所有牌局功能統一讀對應主桌：

- BAV01_LIVE  -> BAV01
- BAV02_LIVE  -> BAV02
- BAV03_LIVE  -> BAV03
- BAV03A_LIVE -> BAV03A

套用範圍：
- 最近結果、牌型、推薦下注
- AI 分析與牌路/問路資料
- V38 四式算牌
- 終值奇偶模型
- Shoe / Round / 牌面 / 點數
- LIVE 桌手動統計下注的開獎結算

不共用：
- LIVE table id / 顯示名稱
- LIVE 荷官名稱、圖片、dealer id/nation
- LIVE stream

因此選到 BAV01_LIVE 時，懸浮仍顯示 BAV01_LIVE，但牌面/牌路/V38/AI 全部即時讀 BAV01。
