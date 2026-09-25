type AdminItem = any;
const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,(m)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]||m));

export const adminPage = (loggedIn=false, loginError="", items:AdminItem[]=[], notice="", dbError="") => {
  const rows=items.map((x:any)=>`<tr data-user="${esc(String(x.username||"").toLowerCase())}">
    <td class="username">${esc(x.username)}</td>
    <td>${x.updated_at?esc(new Date(x.updated_at).toLocaleString("zh-TW",{hour12:false})):"—"}</td>
    <td><form method="POST" action="/api/admin/whitelist/${x.id}/delete-form" onsubmit="return confirm('確定刪除此登入帳號？')"><button class="danger">刪除</button></form></td>
  </tr>`).join("");

  return `<!doctype html><html lang="zh-Hant"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#05090d">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="後台管理系統">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="/admin-manifest.webmanifest">
  <link rel="apple-touch-icon" href="/admin-apple-touch-icon.png">
  <link rel="icon" type="image/png" href="/admin-icon-192.png">
  <title>MT × 聖甲｜共用白名單後台</title>
  <style>
  *{box-sizing:border-box}:root{--line:#263a49;--gold:#e3bd70;--blue:#4ad9ff;--text:#f4f8fa;--muted:#8195a4;--green:#4de1a2;--red:#ff7b86}
  body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% -8%,#183047 0,#09141e 34%,#03070b 74%);color:var(--text);font-family:Inter,system-ui,-apple-system,"Noto Sans TC",sans-serif}
  .wrap{max-width:1040px;margin:auto;padding:26px 18px calc(28px + env(safe-area-inset-bottom))}.top,.brand,.toolbar{display:flex;align-items:center}.top{justify-content:space-between;gap:14px;margin-bottom:18px}.brand{gap:13px}
  .brandIcon{width:58px;height:58px;border-radius:17px;object-fit:cover;border:1px solid #8e713e;box-shadow:0 0 28px #35cbff2b}.login .brandIcon{width:88px;height:88px;border-radius:24px}.brand h1{margin:0;font-size:22px}.brand p{margin:4px 0 0;color:var(--blue);font-size:10px;letter-spacing:1.5px}.subline{margin-top:5px;color:#d5bc7d;font-size:11px}
  .card,.stat{background:linear-gradient(155deg,rgba(13,24,34,.93),rgba(6,12,19,.96));border:1px solid var(--line);border-radius:18px;box-shadow:0 20px 55px #0005;backdrop-filter:blur(12px)}.card{padding:17px;margin-bottom:14px}.login{max-width:470px;margin:8vh auto;padding:24px}.login h2{margin:22px 0 18px}.stats{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:14px}.stat{padding:17px}.stat span,.label{font-size:10px;color:var(--muted)}.stat b{display:block;font-size:28px;margin-top:5px}
  input{height:46px;background:#06121d;border:1px solid #2d4a5e;border-radius:12px;color:#fff;padding:0 13px;font-size:15px}button{height:44px;border:1px solid #7d6338;border-radius:11px;padding:0 16px;background:linear-gradient(135deg,#e7c275,#a9854a);color:#071019;font-weight:900;cursor:pointer}button.danger{height:33px;background:#281318;color:#ffadb4;border-color:#693039;font-size:11px}
  .toolbar{gap:9px;flex-wrap:wrap}.toolbar input{flex:1;min-width:220px}.addgrid{display:grid;grid-template-columns:1fr auto;gap:9px;align-items:end}.field{display:flex;flex-direction:column;gap:6px}.tablewrap{overflow:auto;padding:0}table{width:100%;border-collapse:collapse;min-width:590px;font-size:13px}th,td{padding:13px 15px;border-bottom:1px solid #203443;text-align:left}th{font-size:9px;color:#8297a5}.username{font-size:15px;font-weight:900}.notice{font-size:12px;padding:11px 13px;border-radius:10px;margin-bottom:12px;background:#10251d;border:1px solid #286149}.error{background:#251317;border-color:#66313a}.live{font-size:10px;color:var(--green);border:1px solid #45d39a55;padding:8px 11px;border-radius:99px}.logout{background:#0a151e;color:#ddd;border-color:#294052}.empty{text-align:center;color:#7f929e;padding:34px}
  @media(max-width:700px){.wrap{padding:15px 10px}.top{align-items:flex-start}.brand h1{font-size:17px}.brandIcon{width:48px;height:48px}.login{margin:5vh auto}.addgrid{grid-template-columns:1fr}.addgrid button{width:100%}}
  </style></head><body><div class="wrap">
  ${!loggedIn?`<form class="card login" method="POST" action="/api/admin/login"><div class="brand"><img class="brandIcon" src="/admin-icon-192.png"><div><h1>後台管理系統</h1><p>MT × SCARAB HEART</p><div class="subline">百家輔助＋聖甲之心 共用登入帳號白名單</div></div></div><h2>管理員驗證</h2><div class="label">ADMIN PASSWORD</div><input style="width:100%;margin-top:7px" name="password" type="password" required><button style="width:100%;margin-top:10px">進入共用後台</button>${loginError?`<div style="color:var(--red);margin-top:10px">${esc(loginError)}</div>`:""}</form>`:
  `<div class="top"><div class="brand"><img class="brandIcon" src="/admin-icon-192.png"><div><h1>MT × 聖甲｜後台管理系統</h1><p>ACCOUNT WHITELIST</p><div class="subline">只管理「登入帳號」｜密碼由 TZ / OFA 平台自行驗證</div></div></div><div class="brand"><span class="live">● DATABASE ONLINE</span><form method="POST" action="/api/admin/logout-form"><button class="logout">登出</button></form></div></div>${notice?`<div class="notice">${esc(notice)}</div>`:""}${dbError?`<div class="notice error">白名單資料庫錯誤：${esc(dbError)}</div>`:""}<div class="stats"><div class="stat"><span>目前可登入帳號</span><b>${items.length}</b></div></div><div class="card"><form class="addgrid" method="POST" action="/api/admin/whitelist-form"><div class="field"><span class="label">登入帳號</span><input name="username" placeholder="輸入 TZ / OFA 登入帳號" autocomplete="off" required></div><button>＋ 新增帳號</button></form></div><div class="card"><div class="toolbar"><input id="q" placeholder="搜尋登入帳號…"></div></div><div class="card tablewrap"><table><thead><tr><th>登入帳號</th><th>最後更新</th><th>管理</th></tr></thead><tbody id="rows">${rows||`<tr><td colspan="3" class="empty">目前沒有白名單帳號</td></tr>`}</tbody></table></div><script>function apply(){let q=(document.getElementById("q").value||"").toLowerCase();document.querySelectorAll("#rows tr[data-user]").forEach(r=>r.style.display=r.dataset.user.includes(q)?"":"none")}document.getElementById("q")?.addEventListener("input",apply)</script>`}
  </div></body></html>`;
};
