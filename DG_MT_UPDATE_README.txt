MT Assistant｜MT + DG 整合版

本版修改重點
1. 登入面板外觀維持原版，不新增 MT / DG 選擇。
2. TZ 登入成功後預設進入 MT，並沿用原本 MT 自動連線。
3. 牌路主頁原「可用桌型」區改為 MT / DG 平台切換，並保留「可用 X 桌」。
4. 切換 DG 後自動使用本次 TZ 登入取得的 DG 授權網址連線，不需手動貼 token / sign。
5. DG 即時資料：WebSocket + Protobuf；支援桌號、荷官、Shoe、局號、倒數、歷史牌路、發牌牌面。
6. DG 牌路沿用 MT 原本版型與格數，只切換為 DG 黑金主題。
7. 懸浮助理跟隨目前平台：MT 吃 MT 資料、DG 吃 DG 資料；選桌、分析、雷達、四式算牌與奇偶工具共用目前平台資料。
8. 「進入平台」依目前選擇開啟 MT 或 DG；回牌路後仍保留目前平台。
9. 登出後平台重置為 MT。

本次新增檔案
- lib/dg-live.ts
- public/dg-vendor/CryptoJS.js
- public/dg-vendor/protobuf.js
- public/dg-vendor/PublicBeanProto.proto

檢查
- app/index.tsx 與 lib/dg-live.ts 已做 TypeScript/TSX 語法轉譯檢查，無語法診斷。
- DG Protobuf 定義與 HAR 實際 WebSocket binary 封包已離線解碼比對。

注意
- DG 授權 token / WebSocket sign 都由每次登入流程動態產生，未把使用者 token 寫死在專案。
- 若部署環境的 DG WebSocket 伺服器日後限制非 DG Origin，需再改為後端 WebSocket bridge；目前版本先以瀏覽器直接 WSS 連線實作。
