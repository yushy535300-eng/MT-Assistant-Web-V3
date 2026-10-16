import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectUserPresence } from '../lib/user-presence-client';

class FakeSocket {
  static OPEN=1;static CONNECTING=0;static CLOSED=3;
  static all: FakeSocket[]=[];
  readyState=0;sent: any[]=[];
  onopen: (()=>void)|null=null;onmessage: ((event:any)=>void)|null=null;
  onclose: ((event:any)=>void)|null=null;onerror: (()=>void)|null=null;
  constructor(public url:string){FakeSocket.all.push(this);}
  send(value:string){this.sent.push(JSON.parse(value));}
  open(){this.readyState=1;this.onopen?.();}
  message(value:any){this.onmessage?.({data:JSON.stringify(value)});}
  close(code=1000){this.readyState=3;this.onclose?.({code});}
}
beforeEach(()=>{
  vi.useFakeTimers();FakeSocket.all=[];
  const w=new EventTarget() as any;w.location={href:'https://autobac.example/'};
  const d=new EventTarget() as any;d.visibilityState='visible';
  vi.stubGlobal('window',w);vi.stubGlobal('document',d);vi.stubGlobal('WebSocket',FakeSocket);
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
describe('presence client privacy and lifecycle',()=>{
  it('sends credential only in a private first frame and reports idle after authentication',()=>{
    const client=connectUserPresence('private-session',()=>false);const socket=FakeSocket.all[0];
    expect(socket.url).toBe('wss://autobac.example/api/presence/ws');expect(socket.url).not.toContain('private-session');
    socket.open();expect(socket.sent).toEqual([{type:'auth',sessionId:'private-session'}]);
    socket.message({type:'authenticated'});expect(socket.sent[1]).toEqual({type:'state',running:false});
    client.dispose();expect(socket.readyState).toBe(3);expect(vi.getTimerCount()).toBe(0);
  });
  it('updates actual run changes, not every tick, and stays connected after stopping',()=>{
    let running=false;const client=connectUserPresence('session',()=>running);const socket=FakeSocket.all[0];
    socket.open();socket.message({type:'authenticated'});running=true;vi.advanceTimersByTime(500);
    expect(socket.sent.at(-1)).toEqual({type:'state',running:true});
    vi.advanceTimersByTime(1000);expect(socket.sent).toHaveLength(3);
    running=false;vi.advanceTimersByTime(500);expect(socket.sent.at(-1)).toEqual({type:'state',running:false});
    expect(socket.readyState).toBe(1);client.dispose();
  });
  it('reconnects abnormal disconnection but does not repeatedly retry revoked sessions',()=>{
    const client=connectUserPresence('session',()=>false);FakeSocket.all[0].close(1006);vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);FakeSocket.all[1].close(1008);vi.advanceTimersByTime(30000);
    window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeSocket.all).toHaveLength(2);client.dispose();
  });
});
