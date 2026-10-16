export function adminOnlinePage(appId: string): string {
  const programs = [
    { id: 'scarab-heart', label: '聖甲之心助手', image: 'scarab', accent: 'scarab' },
    { id: 'autobac', label: '百家自動下注', image: 'autobac', accent: 'autobac' },
    { id: 'baccarat-helper', label: '多平台百家輔助', image: 'helper', accent: 'helper' },
  ];
  const selected = programs.find(program => program.id === appId);
  if (!selected) throw new Error('invalid_presence_app');
  const sections = [selected].map(program => `<section class="roster-card ${program.accent}" aria-labelledby="heading-${program.id}">
    <div class="roster-heading"><img src="/admin-brand-v3215/${program.image}.png" alt="" width="48" height="48"><h2 id="heading-${program.id}">${program.label}</h2></div>
    <p class="roster-count"><strong id="online-count-${program.id}">待同步</strong><span>人在線</span></p>
    <div id="online-list-${program.id}" class="roster-users">待同步</div>
  </section>`).join('');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${selected.label}會員名單｜白名單管理</title><link rel="icon" href="/admin-icon-192.png"><link rel="stylesheet" href="/admin-brand-v3220.css"></head>
  <body class="online-page"><main class="wrap"><header class="online-page-top"><div><p class="online-page-eyebrow">白名單管理</p><h1>${selected.label}會員名單</h1></div><a class="online-back" href="/admin">返回管理首頁</a></header><p id="roster-status" class="roster-status" role="status">正在讀取在線帳號…</p><div class="roster-sections single-roster">${sections}</div></main>
  <script>
  const knownIds=['scarab-heart','autobac','baccarat-helper'];
  const appIds=${JSON.stringify([selected.id])};
  function validCount(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
  function clearLists(){for(const id of appIds){const list=document.getElementById('online-list-'+id);list.textContent='待同步';delete list.dataset.signature;}}
  function unavailable(){for(const id of appIds)document.getElementById('online-count-'+id).textContent='待同步';clearLists();document.getElementById('roster-status').textContent='資料尚未同步';}
  function showPresence(data){
    if(!data||data.ok!==true||!Array.isArray(data.applications))throw Error('unavailable');
    const sites=new Map();for(const site of data.applications){if(!site||!knownIds.includes(site.appId)||sites.has(site.appId)||!validCount(site.onlineAccounts))throw Error('unavailable');sites.set(site.appId,site);}
    if(sites.size!==knownIds.length)throw Error('unavailable');
    for(const id of appIds)document.getElementById('online-count-'+id).textContent=String(sites.get(id).onlineAccounts);
    if(!Array.isArray(data.onlineUsers)){clearLists();document.getElementById('roster-status').textContent='帳號名單待同步';return;}
    const groups=new Map(knownIds.map(id=>[id,[]])),keys=new Set();
    for(const user of data.onlineUsers){
      if(!user||!groups.has(user.appId)||typeof user.platform!=='string'||!user.platform.trim()||typeof user.username!=='string'||!user.username.trim()||user.platform.length>16||user.username.length>128)throw Error('unavailable');
      const key=JSON.stringify([user.appId,user.platform.toUpperCase(),user.username.toLowerCase()]);if(keys.has(key))throw Error('unavailable');keys.add(key);groups.get(user.appId).push(user);
    }
    for(const [id,users]of groups)if(users.length!==sites.get(id).onlineAccounts)throw Error('unavailable');
    for(const [id,users]of groups){
      if(!appIds.includes(id))continue;
      const container=document.getElementById('online-list-'+id),signature=JSON.stringify(users);if(container.dataset.signature===signature)continue;
      const fragment=document.createDocumentFragment();
      if(!users.length){const empty=document.createElement('p');empty.className='online-empty';empty.textContent='目前無在線帳號';fragment.append(empty);}
      for(const user of users){const row=document.createElement('div');row.className='online-user';const name=document.createElement('span');name.className='online-user-name';name.textContent=user.username;name.title=user.username;const platform=document.createElement('span');platform.className='online-user-platform';platform.textContent=user.platform;row.append(name,platform);fragment.append(row);}
      container.replaceChildren(fragment);container.dataset.signature=signature;
    }
    document.getElementById('roster-status').textContent='';
  }
  let busy=false;
  async function refreshOnline(){if(busy)return;busy=true;try{const response=await fetch('/api/admin/presence',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('unavailable');showPresence(await response.json());}catch{unavailable();}finally{busy=false;}}
  refreshOnline();setInterval(()=>{if(!document.hidden)refreshOnline();},3000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshOnline();});
  </script></body></html>`;
}
