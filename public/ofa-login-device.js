(()=>{
  'use strict';
  if(window.__ofaDeviceCompatibility)return;
  window.__ofaDeviceCompatibility=true;
  const originalFetch=window.fetch.bind(window);
  let retryAt=0;
  const cached={};
  function deviceId(isTZ){
    const storageKey=isTZ?'tz_login_device_id_v1':'ofa_login_device_id_v1';
    if(cached[storageKey])return cached[storageKey];
    try{const value=localStorage.getItem(storageKey);if(/^[a-f0-9]{32}$/.test(value||''))return cached[storageKey]=value;}catch{}
    const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
    cached[storageKey]=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
    try{localStorage.setItem(storageKey,cached[storageKey]);}catch{}
    return cached[storageKey];
  }
  window.fetch=async function(input,init){
    let url;try{url=new URL(typeof input==='string'?input:input?.url||String(input),location.href);}catch{return originalFetch(input,init);}
    // Keep OFA compatibility and apply the same verified 32-hex wire format to TZ.
    const isOFA=url.origin==='https://www.ofa1188.net';
    const isTZ=/^https:\/\/www\.tz6868\.(?:cc|com)$/.test(url.origin);
    if(!(isOFA||isTZ)||url.pathname!=='/api/v1/login'||String(init?.method||'GET').toUpperCase()!=='POST'||typeof init?.body!=='string')return originalFetch(input,init);
    if(Date.now()<retryAt)throw Error('平台暫時限制登入次數，請於 '+Math.ceil((retryAt-Date.now())/1000)+' 秒後重試');
    let body;try{body=JSON.parse(init.body);}catch{return originalFetch(input,init);}
    if(!body||typeof body!=='object'||Array.isArray(body))return originalFetch(input,init);
    // Match the application's device_id wire format; never copy another user's ID,
    // alter browser headers, or manufacture/reuse a verification token.
    if(!/^[a-f0-9]{32}$/i.test(body.device_id||''))body={...body,device_id:deviceId(isTZ)};
    const response=await originalFetch(input,{...init,body:JSON.stringify(body)});
    if(response.status===429){const header=response.headers.get('Retry-After'),seconds=Number(header),date=Date.parse(header||'');retryAt=Date.now()+(seconds>0?seconds*1000:Number.isFinite(date)?Math.max(0,date-Date.now()):60000);}
    return response;
  };
})();
