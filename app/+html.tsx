import {ScrollViewStyleReset} from 'expo-router/html';
export default function Root({children}:any){return <html lang="zh-Hant"><head><meta charSet="utf-8"/><script src="/agent-context.js?v=3" defer />
      <script src="/ofa-login-device.js?v=1" defer />
      <ScrollViewStyleReset /></head><body>{children}</body></html>;}
