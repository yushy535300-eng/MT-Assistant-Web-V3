# Render deployment

Build Command:

```
pnpm install --frozen-lockfile && pnpm build
```

Start Command:

```
pnpm start
```

Environment Variables:

- `APP_USERNAME` — website login username
- `APP_PASSWORD` — website login password

Root Directory: leave blank.
Runtime: Node.

## DG Chromium relay (2026-09-17)

No Render command change is required. `pnpm install --frozen-lockfile` now runs the project's `postinstall` script. On Linux x64, if Render does not already provide Chrome/Chromium, the script downloads Google Chrome stable into `.chrome/` for the DG headless-browser relay.

Optional environment variable:

- `DG_CHROME_PATH` — explicitly point to a Chrome/Chromium executable.
