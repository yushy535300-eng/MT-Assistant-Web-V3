# T9 Login Referer / Header 修正

真實 T9 成功 HAR：
- POST https://g.t9gaming.fun/api/Lobby/login
- Origin: https://g.t9gaming.fun
- Referer: https://g.t9gaming.fun/VideoBaccarat/index.html?... 
- sec-fetch-site: same-origin
- sec-fetch-mode: cors
- sec-fetch-dest: empty

舊代理問題：
Referer 會錯誤變成：
https://g.t9gaming.fun/api/ext/host/g.t9gaming.fun/VideoBaccarat/index.html?...

修正：
- 自動移除 `/api/ext/host/<host>` proxy 前綴
- vendor 收到真正的 `/VideoBaccarat/index.html?...`
- 轉送 sec-ch-ua / sec-fetch-* / priority
- T9 Lobby/login server log 只記錄 status/header，不記錄 Token 或 body
