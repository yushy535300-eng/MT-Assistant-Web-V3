package com.mtassistant.tz;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.webkit.*;
import android.view.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

public class MainActivity extends Activity {
    private WebView web;
    private static final String APP_URL="https://mt-assistant-web-v3.onrender.com/";
    private static final String TZ_HOST="www.tz6868.cc";

    @Override public void onCreate(Bundle b){
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.rgb(2,10,18));
        getWindow().setNavigationBarColor(Color.rgb(2,10,18));
        web=new WebView(this); web.setBackgroundColor(Color.rgb(2,10,18));
        setContentView(web,new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT));
        WebSettings s=web.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true); s.setMediaPlaybackRequiresUserGesture(false); s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER); web.setVerticalScrollBarEnabled(false); web.setHorizontalScrollBarEnabled(false);
        web.addJavascriptInterface(new NativeBridge(),"NativeBridge");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView v,String url){ injectNativeHttp(v); }
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){
                UriGuard g=UriGuard.of(r.getUrl().toString());
                if(g.isHttp()) return false;
                return true;
            }
        });
        WebView.setWebContentsDebuggingEnabled(false);
        web.loadUrl(APP_URL);
    }

    private void injectNativeHttp(WebView v){
        String js="(function(){if(window.__MT_TZ_NATIVE)return;window.__MT_TZ_NATIVE=1;window.__httpCbs={};"+
          "window.__nativeHttpDone=function(id,ok,p){var x=window.__httpCbs[id];if(!x)return;delete window.__httpCbs[id];try{var o=JSON.parse(p);ok?x.r(o):x.j(new Error((o&&o.message)||'HTTP error'));}catch(e){ok?x.r(p):x.j(e);}};"+
          "window.Capacitor=window.Capacitor||{};window.Capacitor.Plugins=window.Capacitor.Plugins||{};"+
          "window.Capacitor.Plugins.CapacitorHttp={request:function(o){return new Promise(function(r,j){var id='h'+Date.now()+Math.random();window.__httpCbs[id]={r:r,j:j};NativeBridge.httpRequest(id,JSON.stringify(o));});}};})();";
        v.evaluateJavascript(js,null);
    }

    private String readAll(InputStream in)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)out.write(buf,0,n);return out.toString(StandardCharsets.UTF_8.name());}

    public class NativeBridge {
        @JavascriptInterface public void httpRequest(String cb,String optionsJson){
            new Thread(()->{
                boolean ok=false; String payload;
                try{
                    JSONObject o=new JSONObject(optionsJson); URL u=new URL(o.getString("url"));
                    // Native bridge is intentionally locked to TZ login HTTPS only.
                    if(!"https".equalsIgnoreCase(u.getProtocol()) || !TZ_HOST.equalsIgnoreCase(u.getHost()) || !"/api/v1/login".equals(u.getPath())) throw new SecurityException("Blocked native HTTP destination");
                    String method=o.optString("method","POST"); if(!"POST".equalsIgnoreCase(method)) throw new SecurityException("Blocked HTTP method");
                    HttpURLConnection c=(HttpURLConnection)u.openConnection(); c.setRequestMethod("POST"); c.setConnectTimeout(o.optInt("connectTimeout",15000)); c.setReadTimeout(o.optInt("readTimeout",15000)); c.setUseCaches(false); c.setDoOutput(true);
                    JSONObject headers=o.optJSONObject("headers"); if(headers!=null){Iterator<String> it=headers.keys();while(it.hasNext()){String k=it.next();c.setRequestProperty(k,headers.optString(k));}}
                    if(headers==null||!headers.has("Content-Type"))c.setRequestProperty("Content-Type","application/json; charset=utf-8");
                    Object data=o.opt("data"); byte[] body=(data instanceof String?(String)data:String.valueOf(data)).getBytes(StandardCharsets.UTF_8); try(OutputStream os=c.getOutputStream()){os.write(body);}
                    int status=c.getResponseCode(); InputStream in=status>=400?c.getErrorStream():c.getInputStream(); String txt=in==null?"":readAll(in);
                    JSONObject res=new JSONObject();res.put("status",status);try{res.put("data",new JSONTokener(txt).nextValue());}catch(Exception e){res.put("data",txt);}payload=res.toString();ok=status<400;
                }catch(Exception e){try{JSONObject er=new JSONObject();er.put("message",e.toString());payload=er.toString();}catch(Exception x){payload="{\"message\":\"error\"}";}}
                final boolean fok=ok;final String fp=payload;runOnUiThread(()->web.evaluateJavascript("window.__nativeHttpDone("+JSONObject.quote(cb)+","+(fok?"true":"false")+","+JSONObject.quote(fp)+")",null));
            }).start();
        }
    }

    static class UriGuard { final String s; UriGuard(String s){this.s=s;} static UriGuard of(String s){return new UriGuard(s);} boolean isHttp(){return s.startsWith("https://")||s.startsWith("http://");} }

    @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
}
