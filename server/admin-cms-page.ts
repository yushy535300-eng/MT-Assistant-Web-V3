const esc=(v:any)=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]||m));

export function adminCmsPage(cms:any={}, notice="", error="") {
  const s=cms?.site||{};
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MT MATRIX｜官網管理</title><style>
  *{box-sizing:border-box}:root{--bg:#05090d;--panel:#0c1217;--line:#2d353c;--gold:#d9b46b;--text:#f3f0e9;--muted:#8d969e;--green:#45d39a;--red:#ff6f79}
  body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% -15%,#20252a 0,#0b0f13 35%,#05080b 72%);color:var(--text);font-family:Inter,system-ui,-apple-system,"Noto Sans TC",sans-serif}
  .wrap{max-width:1100px;margin:auto;padding:28px 20px}.top,.brand,.tabs{display:flex;align-items:center}.top{justify-content:space-between;margin-bottom:18px}.brand{gap:13px}.mark{width:42px;height:42px;border:1px solid #8e7040;border-radius:12px;display:grid;place-items:center;color:var(--gold);font-weight:900}
  h1{font-size:21px;margin:0}.sub{font-size:10px;margin:4px 0;color:var(--gold);letter-spacing:2px}.tabs{gap:8px;margin-bottom:14px}.tab{display:inline-flex;align-items:center;height:40px;padding:0 14px;border-radius:9px;text-decoration:none;font-weight:800;border:1px solid #30383e;background:#11171c;color:#ddd}.tab.active{background:linear-gradient(#d6b36d,#9e7c43);color:#111;border-color:#725b35}
  .card{background:rgba(12,18,23,.9);border:1px solid var(--line);border-radius:15px;padding:16px;margin-bottom:14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.wide{grid-column:1/-1}.field{display:flex;flex-direction:column;gap:6px}.label{font-size:10px;color:var(--muted);letter-spacing:1px}
  input,select,textarea{background:#080d11;border:1px solid #30383e;border-radius:10px;color:#fff;padding:10px}input,select{height:42px}textarea{min-height:110px;resize:vertical}.json{min-height:240px;font-family:ui-monospace,Consolas,monospace;font-size:12px}
  button{height:42px;border:1px solid #725b35;border-radius:9px;padding:0 16px;background:linear-gradient(#d6b36d,#9e7c43);font-weight:900;cursor:pointer}.notice{font-size:12px;padding:10px 12px;border-radius:9px;margin-bottom:12px;background:#12201b;border:1px solid #285c47}.error{background:#251317;border-color:#66313a;color:#ff9ca4}
  @media(max-width:760px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}.wrap{padding:18px 12px}}
  </style></head><body><div class="wrap">
  <div class="top"><div class="brand"><div class="mark">M</div><div><h1>MT MATRIX</h1><div class="sub">WEBSITE CMS</div></div></div><a class="tab" href="/admin">返回授權後台</a></div>
  <div class="tabs"><a class="tab" href="/admin">授權管理</a><a class="tab active" href="/admin/cms">官網管理</a></div>
  ${notice?`<div class="notice">${esc(notice)}</div>`:""}${error?`<div class="notice error">${esc(error)}</div>`:""}
  <form method="POST" action="/api/admin/cms-form">
    <div class="card"><h3>首頁設定</h3><div class="grid">
      <div class="field"><span class="label">品牌名稱</span><input name="brand" value="${esc(s.brand)}"></div>
      <div class="field"><span class="label">副標題</span><input name="tagline" value="${esc(s.tagline)}"></div>
      <div class="field wide"><span class="label">首頁介紹</span><textarea name="lead">${esc(s.lead)}</textarea></div>
      <div class="field wide"><span class="label">活動文字</span><input name="promo" value="${esc(s.promo)}"></div>
      <div class="field"><span class="label">電腦主視覺圖片網址</span><input name="heroDesktopImage" value="${esc(s.heroDesktopImage)}"></div>
      <div class="field"><span class="label">手機主視覺圖片網址</span><input name="heroMobileImage" value="${esc(s.heroMobileImage)}"></div>
      <div class="field"><span class="label">主要按鈕文字</span><input name="primaryButtonText" value="${esc(s.primaryButtonText)}"></div>
      <div class="field"><span class="label">主要按鈕連結</span><input name="primaryButtonLink" value="${esc(s.primaryButtonLink)}"></div>
      <div class="field"><span class="label">ATG 按鈕文字</span><input name="secondaryButtonText" value="${esc(s.secondaryButtonText||"ATG數據分析選房")}"></div>
      <div class="field"><span class="label">ATG 按鈕連結</span><input name="secondaryButtonLink" value="${esc(s.secondaryButtonLink||"/atgslot/")}"></div>
      <div class="field wide"><span class="label">公告</span><input name="announcement" value="${esc(s.announcement)}"></div>
      <div class="field"><span class="label">公告顯示</span><select name="announcementVisible"><option value="0">隱藏</option><option value="1" ${s.announcementVisible?"selected":""}>顯示</option></select></div>
      <div class="field"><span class="label">商品區標題</span><input name="pricingTitle" value="${esc(s.pricingTitle)}"></div>
      <div class="field wide"><span class="label">商品區說明</span><input name="pricingLead" value="${esc(s.pricingLead)}"></div>
    </div></div>
    <div class="card"><h3>商品／方案</h3><p class="label">可新增、刪除、改價格與功能。格式為 JSON 陣列。</p><textarea class="json" name="products">${esc(JSON.stringify(cms?.products||[],null,2))}</textarea></div>
    <div class="card"><h3>功能介紹</h3><textarea class="json" name="features">${esc(JSON.stringify(cms?.features||[],null,2))}</textarea></div>
    <div class="card"><h3>快速連結</h3><textarea class="json" name="links">${esc(JSON.stringify(cms?.links||[],null,2))}</textarea></div>
    <button type="submit">儲存並同步官網</button>
  </form></div></body></html>`;
}
