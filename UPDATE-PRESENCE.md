# 共用白名單在線統計更新

本更新為 **百家輔助 (`baccarat-helper`)** 加入與 AutoBac、Scarab 共用的登入帳號在線統計。此套件只包含原始碼與匿名測試；未包含 `.env`、資料庫內容、帳號憑證或生產連線設定。

## 組成

- `server/user-presence.ts`：可攜、共用的 presence 模組（與已定稿版本保持一致）。它只透過注入的相依項目使用資料庫與登入驗證。
- `lib/user-presence-client.ts`：同源 WebSocket 用戶端（與已定稿版本保持一致）。
- `server/sessions.ts`：`readRiskTrackerIdentity` 是本專案的唯讀 adapter；它以 `tracker_sessions` 與 `tz_whitelist` join 驗證目前 session、已啟用且未到期的白名單，**不會**初始化、遷移或 seed 原白名單表。
- `server/_core/index.ts`：以現有的 `getPool`、現有管理員 middleware 及該 adapter 註冊：

  ```ts
  registerUserPresence(app, server, requireAdmin, {
    appId: "baccarat-helper",
    getPool,
    readRiskTrackerIdentity,
    publicOrigin: process.env.PRESENCE_PUBLIC_ORIGIN || "https://mt-assistant-web-v3.onrender.com",
  });
  ```

- `app/index.tsx`：只在既有 `accessGranted` 和 `accessSessionId` 同時有效且在 Web 環境時連線；cleanup／登出／session 失效都會 dispose。百家輔助沒有自動下注，因此 `getRunning` 固定回傳 `false`。
- 原有的白名單 `max_devices`、tracker session 及既有登入／登出行為均未放寬或改寫；presence 不會建立替代授權。

## 通訊與隱私

- WebSocket 是同源 `GET /api/presence/ws` upgrade；必須有完整相同 scheme + authority 的 `http:` 或 `https:` Origin，不能帶 query string。同一 host 但 `http:`／`https:` 不同也會回 `403`。
- 首個且唯一的資料 frame 是：`{"type":"auth","sessionId":"..."}`。session ID 不在 URL、presence 資料表或日誌中。
- 成功時伺服器回傳 `{"type":"authenticated"}`；用戶端隨後發送 `{"type":"state","running":false}`。
- Presence 資料表僅有 `connection_id`、`platform`、`username_key`、`running`、`last_seen_at`、`app_id`。不儲存瀏覽捲動、IP、登入密碼、session ID、遊戲 URL 或歷史事件。
- `GET /api/admin/presence` 沿用本站管理員驗證，設定 `Cache-Control: no-store`，且以平台 + 帳號（不以 app ID）分組；只計已啟用、未到期的 `tz_whitelist` 帳號。資料庫不可用時回傳 `503`，不偽裝成零。

## 公開 Origin（TLS 反向代理）

- 現有 Render 部署不需要新增設定：註冊器明確使用既有的 `https://mt-assistant-web-v3.onrender.com`，讓 TLS 在代理終止、Node 端仍為 plaintext HTTP 時，仍只接受該公開 HTTPS Origin。
- 本機開發不設 `PRESENCE_PUBLIC_ORIGIN` 即可；預設依本機 socket transport 比對，plaintext localhost 僅接受 `http:`，同 host 的 `https:` 會被拒絕。
- 只有自訂公開網域或不同的 TLS termination 網域才可在執行環境設定 `PRESENCE_PUBLIC_ORIGIN=https://example.com`。它是明確 allow-origin，不採信可偽造的 forwarded headers；本更新**沒有**變更任何平台、Render、網路服務或憑證設定。

## Lockfile 修復與穩定相依性

原始 `pnpm-lock.yaml` 的既有解析中，`postgres-interval@1.2.0` 已引用 `xtend@4.0.2`，但缺少該 package/snapshot；同一個已釘選的 `pg`／`@types/pg` 樹也含有空白 resolution records。這會使 `pnpm install --frozen-lockfile` 無法可靠還原。

修復先以 `pnpm install --lockfile-only --fix-lockfile --ignore-scripts` 只修 lockfile，並以相同 AutoBac canonical lock 的 records 補足 `xtend@4.0.2` 及既有 `pg` 樹的 resolution integrity/snapshots；沒有替換 helper 的整份 lockfile，也沒有修改 `package.json`。

| 比對項目 | 修復後結果 |
| --- | --- |
| `dependencies` / `devDependencies` 對 canonical | 完全相同（0 個直接相依版本差異） |
| package manager / Node | `pnpm@9.12.0` / `node 22.x`，維持不變 |
| 相關鎖定版本 | `@types/pg@8.15.5`、`pg@8.16.3`、`postgres-interval@1.2.0`、`xtend@4.0.2`，皆維持既有版本 |
| 依賴升級 | 無；只有缺漏的既有 lock records 被補回 |

## 安全驗證（無真實平台／憑證／資料庫）

```bash
pnpm install --frozen-lockfile
pnpm vitest run tests/user-presence.test.ts tests/user-presence-client.test.ts tests/user-presence-wiring.test.ts
pnpm check
pnpm build
```

測試中的資料庫、管理員 token、HTTP server 都是 process-local mock／localhost；不使用 `DATABASE_URL` 或 `.env`。
