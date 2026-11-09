(()=>{'use strict';
const key='scarab.agent.entry',query=new URLSearchParams(location.search);
let slug=query.get('agent');try{if(slug)sessionStorage.setItem(key,slug);else slug=sessionStorage.getItem(key);}catch{}
if(!slug)return;
const valid=/^[a-zA-Z][a-zA-Z0-9_-]{2,39}$/.test(slug)||/^[a-f0-9-]{36}$/i.test(slug);
const programOrigins=['https://scarabheart2.onrender.com','https://mt-assistant-web-v3.onrender.com','https://autotable-o6a2.onrender.com'];
const originalOpen=window.open;let config=null;
const notice=message=>{let el=document.getElementById('agentEntryNotice');if(!el){el=document.createElement('div');el.id='agentEntryNotice';el.setAttribute('role','alert');Object.assign(el.style,{position:'fixed',inset:'0',zIndex:'2147483647',background:'#111820',color:'#fff',display:'grid',placeItems:'center',padding:'24px',textAlign:'center'});document.body.append(el);}el.textContent=message;};
const currentThreads=()=>config?.links?.threads||null;
let lastThreadsHandle='@uss0857';
function threadsHandle(){
 const raw=currentThreads();if(!raw)return null;
 try{
  const part=decodeURIComponent(new URL(raw).pathname.split('/').filter(Boolean)[0]||'');
  return /^@[A-Za-z0-9_.]+$/.test(part)?part:null;
 }catch{return null;}
}
function updateThreadsLabels(root){
 const handle=threadsHandle();if(!handle||!root)return;
 const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 const nodes=[];while(walk.nextNode())nodes.push(walk.currentNode);
 for(const node of nodes){
  const p=node.parentElement;
  if(!p||p.closest('script,style,textarea,input,[contenteditable="true"]'))continue;
  const old=node.nodeValue||'';
  const changed=old.replace(/@uss0857\b/g,handle).split(lastThreadsHandle).join(handle);
  if(changed!==old)node.nodeValue=changed;
  if(p.hasAttribute('aria-label')){
   const label=p.getAttribute('aria-label');
   if(label&&label.includes('@uss0857'))p.setAttribute('aria-label',label.replace(/@uss0857\b/g,handle));
  }
 }
 lastThreadsHandle=handle;
}

function destination(url,label=''){
 if(!config)return null;
 let u;try{u=new URL(String(url),location.href);}catch{return null;}
 const host=u.hostname.toLowerCase(),name=String(label||'');
 if(['line.me','lin.ee'].includes(host)||/LINE|客服|聯繫|忘記密碼/i.test(name))return config.links.support||null;
 if(['threads.com','www.threads.com'].includes(host)||/threads|脆|追蹤|follow/i.test(name))return currentThreads()||'#';
 if(u.searchParams.get('id')==='register'||host==='shy9453.tz6868.cc'||/註冊|建立帳號/i.test(name))return config.links.register||null;
 if(programOrigins.includes(u.origin)){
  const entry=Object.values(config.entries||{}).find(v=>{try{return new URL(v).origin===u.origin;}catch{return false;}});
  if(!entry)return '#';
  u.searchParams.set('agent',slug);return u.href;
 }
 if(u.origin===location.origin&&!u.pathname.startsWith('/admin')&&!u.pathname.startsWith('/api/')){
  u.searchParams.set('agent',slug);return u.href;
 }
 return null;
}
window.open=function(url,...args){const target=destination(url);if(target==='#')return null;return originalOpen.call(window,target||url,...args);};
function bind(root){
 if(!config||root.nodeType!==1)return;
 updateThreadsLabels(root);
 const links=[...(root.matches('a[href]')?[root]:[]),...root.querySelectorAll('a[href]')];
 for(const a of links){
  const target=destination(a.getAttribute('href'),a.textContent);
  if(target==='#'){a.hidden=true;continue;}
  if(target&&target!==a.href)a.href=target;
 }
}
document.addEventListener('click',ev=>{
 if(!config)return;
 const el=ev.target.closest('a,button,[role="button"]');if(!el)return;
 const words=(el.textContent||'')+' '+(el.getAttribute('aria-label')||'');
 const parent=el.closest('[class*="threads"],[class*="Threads"]');
 const label=parent?words+' threads':words;
 const href=el.getAttribute('href');
 const target=destination(href||location.href,label);
 if(target==='#'){ev.preventDefault();ev.stopImmediatePropagation();return;}
 if(target&&/註冊|LINE|客服|聯繫|忘記密碼|threads|脆|follow|追蹤/i.test(label)){
   ev.preventDefault();ev.stopImmediatePropagation();originalOpen.call(window,target,'_blank','noopener,noreferrer');
 }
},true);
async function update(){
 try{
  if(!valid)throw Error('代理入口無效');
  if(!config)notice('正在讀取代理入口…');
  const response=await fetch('/api/agent-context?agent='+encodeURIComponent(slug),{cache:'no-store'});
  const data=await response.json();
  if(!response.ok||!data.active)throw Error(data.error||'代理入口無法讀取');
  config=data;
  document.getElementById('agentContactLinks')?.remove();
  bind(document.body);
  document.getElementById('agentEntryNotice')?.remove();
 }catch(error){config=null;notice(error.message||'代理入口暫時無法使用');}
}
new MutationObserver(records=>{if(!config)return;records.forEach(record=>record.addedNodes.forEach(bind));}).observe(document.documentElement,{childList:true,subtree:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',update);else update();
setInterval(update,30000);
})();
