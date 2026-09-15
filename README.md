# MT Assistant V34 — 完整網站復刻版

這份專案直接以原始 `tracker-v34-mt-restore最新2.zip` 的 React Native / Expo Web 畫面與牌路邏輯為基礎，不是重新設計的簡易網站。

## 保留內容

- 原版 MT ASSISTANT 登入畫面
- 原版頂部控制列與分類列
- 15 桌百家樂卡片
- 荷官、房間、Shoe、Round、倒數與莊/閒/和統計
- 珠盤 36 顆、大路、下三路
- 單桌分析彈窗
- MT 連線設定視窗
- `wss://a1.ofalive99.net/game/ws` 即時 WebSocket 流程
- `/authenticate`、`/tables`、`/tablesvg`、`multiple_join`、`show_win`、`wait/end` 更新
- 原版可拖動右下角懸浮球
- 原版橫向 MT 懸浮輔助與自動監看頁籤

## 已拔除 Manus 依賴

正式網站啟動不再呼叫 Manus OAuth、Manus runtime、Manus storage proxy 或 Manus heartbeat。網站登入只走同站 `/api/trpc/trackerAccess.login`。

## 本機開發

需要 Node.js 20+ 與 pnpm。

```bash
cp .env.example .env
pnpm install
pnpm dev
```

前端開發頁預設為 `http://localhost:8081`，API 為 `http://localhost:3000`。正式部署請使用下面的 build/start 流程，前後端會由同一個網址提供。

## 正式網站

```bash
cp .env.example .env
# 修改 TRACKER_LOGIN_PASSWORD
pnpm install
pnpm build
pnpm start
```

瀏覽器開啟：

```text
http://localhost:3000
```

## MT 即時資料

網站本身已獨立於 Manus，但真實牌路仍需要來源 MT 工作階段授權。登入 MT 後，把帶 `token` 的完整 MT 網址貼進「連線」視窗，再開始連線。

> 若來源 WebSocket 有 Origin、Cookie、Token 或 IP 限制，是否能從公開網域連線仍由來源伺服器決定，這與 Manus 無關。

## TZ 白名單管理後台

本版本新增 `/admin` 授權管理頁。Render Environment 需要設定：

- `ADMIN_PASSWORD`：管理後台登入密碼（請使用長且唯一的密碼）
- `TZ_WHITELIST_ENABLED=true`：啟用 TZ 白名單檢查
- `DATABASE_URL`：既有 MySQL 資料庫連線；白名單資料會持久化於資料庫

部署後開啟 `https://你的網域/admin` 即可新增 7/30/90 天或永久授權、設定裝置上限、停用、+30 天、解除裝置與刪除。

建議先保持 `TZ_WHITELIST_ENABLED=false` 完成部署並登入 `/admin` 新增自己的 TZ 帳號，確認資料庫正常後，再把 `TZ_WHITELIST_ENABLED` 改為 `true`，避免第一次部署時把自己鎖在程式外。

## TZ whitelist v9
- First batch: 98 TZ accounts preloaded as ACTIVE / permanent.
- Uses persistent seed marker `tz_whitelist_initial_seed_v2`, so this deployment imports the first batch once even if an older v8 marker exists.
- After v9 seed completes, deleting/disabling accounts in `/admin` is persistent and does not require Render restart/redeploy.
- Login order remains TZ credential verification in browser -> server whitelist authorization -> MTLI.
