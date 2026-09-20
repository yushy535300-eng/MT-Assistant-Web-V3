# Render 部署

## 1. 先把程式推到 GitHub

本專案推上去之後，在 Render 選 **New Web Service** → 連這個 GitHub repo。

## 2. Render 設定

- **Runtime:** Node
- **Root Directory:** 空白
- **Build Command:**

```bash
pnpm install --frozen-lockfile && pnpm build
```

- **Start Command:**

```bash
pnpm start
```

第一次或新增 `postinstall`（安裝 Chromium）後，請勾 **Clear build cache & deploy**。只重啟舊服務不會裝 Chrome，歐博／DB 背景擷取會失敗。

## 3. Environment Variables

最少要設：

| 變數 | 說明 |
|------|------|
| `TZ_WHITELIST_ENABLED` | 第一次先 `false`，確認能登入後再改 `true` |
| `ADMIN_PASSWORD` | `/admin` 後台密碼，請用長且唯一的密碼 |
| `DATABASE_URL` | Render PostgreSQL 的 Internal Database URL（啟用白名單時必填） |

可選：

| 變數 | 說明 |
|------|------|
| `DG_CHROME_PATH` | 若機器已有 Chrome，可指定執行檔路徑 |
| `PORT` | Render 會自動給，不必自設 |

登入仍用 TZ／OFA 帳密；白名單帳號在 `/admin` 管理。

## 4. 建議流程

1. 建 Render PostgreSQL（與 Web Service 同區域）。
2. Web Service 的 `DATABASE_URL` 貼 Internal URL。
3. `TZ_WHITELIST_ENABLED=false` 先部署並登入 `/admin`，把你的 TZ 帳號加進白名單。
4. 再把 `TZ_WHITELIST_ENABLED` 改成 `true` 後 Redeploy。
