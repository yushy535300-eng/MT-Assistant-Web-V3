# Render 部署

MT／DG 輔助程式。Docker 部署較穩（DG 背景可能用到 Chromium）。

## 建議：Docker Web Service

1. Render → **New Web Service** → 連 GitHub repo  
2. **Language / Runtime:** Docker  
3. 使用本 repo 的 `Dockerfile`  
4. 第一次勾 **Clear build cache & deploy**

## 備案：Native Node

- **Build Command:** `pnpm install --frozen-lockfile && pnpm build`
- **Start Command:** `pnpm start`

部署後打開 `https://你的網域/api/health` 確認 `ok: true`。

## Environment Variables

| 變數 | 說明 |
|------|------|
| `TZ_WHITELIST_ENABLED` | 第一次先 `false`，確認能登入後再改 `true` |
| `ADMIN_PASSWORD` | `/admin` 後台密碼 |
| `DATABASE_URL` | Render PostgreSQL Internal URL（啟用白名單時必填） |
| `DG_CHROME_PATH` | 可選，指定 Chrome 路徑 |
| `PORT` | Render 自動給 |

登入用 TZ／OFA 帳密；白名單在 `/admin` 管理。

## 平台

- **MT / DG**：牌路連線與進桌（勿隨意改動）
- **SA**：主頁即時牌路（connect2explorer relay）+ 懸浮輔助；進入 → TZ `/api/v2/game/{code}/login` → 同源代理內嵌（剝 X-Frame），進站時轉 bridge 吃遊戲 WS。
- **美女直播**：登入後按進入 → TZ `LIVE77` 授權 → 新分頁 `registerAndLogin`；主頁牌卡點進、不轉點、無懸浮球
