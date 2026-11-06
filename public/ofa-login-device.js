(()=>{
  'use strict';
  if(window.__ofaDeviceCompatibility)return;
  window.__ofaDeviceCompatibility=true;
  const originalFetch=window.fetch.bind(window);
  const storageKey='ofa_login_device_id_v1';
  let cached='',retryAt=0;
  function deviceId(){
    if(cached)return cached;
    try{const value=localStorage.getItem(storageKey);if(/^[a-f0-9]{32}$/.test(value||''))return cached=value;}catch{}
    const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
    cached=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
    try{localStorage.setItem(storageKey,cached);}catch{}
    return cached;
  }
  window.fetch=async function(input,init){
    let url;try{url=new URL(typeof input==='string'?input:input?.url||String(input),location.href);}catch{return originalFetch(input,init);}
    if(url.origin!=='https://www.ofa1188.net'||url.pathname!=='/api/v1/login'||String(init?.method||'GET').toUpperCase()!=='POST'||typeof init?.body!=='string')return originalFetch(input,init);
    if(Date.now()<retryAt)throw Error('OFA 暫時限制登入次數，請於 '+Math.ceil((retryAt-Date.now())/1000)+' 秒後重試');
    let body;try{body=JSON.parse(init.body);}catch{return originalFetch(input,init);}
    if(!body||typeof body!=='object'||Array.isArray(body))return originalFetch(input,init);
    // Match the application's device_id wire format; never copy another user's ID,
    // alter browser headers, or manufacture/reuse a verification token.
    if(!/^[a-f0-9]{32}$/i.test(body.device_id||''))body={...body,device_id:deviceId()};
    const response=await originalFetch(input,{...init,body:JSON.stringify(body)});
    if(response.status===429){const header=response.headers.get('Retry-After'),seconds=Number(header),date=Date.parse(header||'');retryAt=Date.now()+(seconds>0?seconds*1000:Number.isFinite(date)?Math.max(0,date-Date.now()):60000);}
    return response;
  };
})();
