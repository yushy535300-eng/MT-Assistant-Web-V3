# T9 iframe 跳回本站登入頁修正

問題：
- T9 launch URL 通常是 `https://g.t9gaming.fun/?...`
- 舊程式對 MV/T9 只回傳 `finalUrl.pathname + finalUrl.search`
- pathname 是 `/`，因此 iframe 實際打開本站 `/`，顯示 MATRIX 自己的登入頁

修正：
- T9 與 SA 一樣，一律使用 `/api/ext/host/<hostname>/...`
- 例如：
  `/api/ext/host/g.t9gaming.fun/?...&__mt_ext_sid=<session>`
- iframe 不會再落到本站 root
- T9 的 customToken/query 保留
- MT / DG / SA 其他流程不變
