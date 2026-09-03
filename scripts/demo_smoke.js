// 演示模式冒烟：启动→推进→校验演示数据独立→退出后用户数据不污染
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_demo_tmp');
const URL = 'file:///' + path.join(ROOT, 'planloop.html').replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function findBrowser(){ for (const c of ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe']) if (fs.existsSync(c)) return c; return null; }
function getJSON(u){ return new Promise((res,rej)=>http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej)); }
class CDP{ constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.events=[];ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}else if(m.method)this.events.push(m);});}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(expr){const r=await this.send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error('JS异常: '+JSON.stringify(r.exceptionDetails.exception||r.exceptionDetails));return r.result&&r.result.value;} }
let pass=0,fail=0; const T=async(n,f)=>{try{await f();pass++;console.log('✓ '+n);}catch(e){fail++;console.error('✗ '+n+' :: '+e.message);}};
const eq=(g,w)=>{if(JSON.stringify(g)!==JSON.stringify(w))throw new Error('期望 '+JSON.stringify(w)+' 实得 '+JSON.stringify(g));};
const ok=v=>{if(!v)throw new Error('断言失败');};

async function main(){
  const bin=findBrowser(); if(!bin) throw new Error('无浏览器');
  const port=9400+Math.floor(Math.random()*300);
  const profile=path.join(OUT,'profile');
  const chrome=spawn(bin,[`--headless=new`,`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','about:blank'],{stdio:'ignore'});
  let target; for(let i=0;i<40;i++){try{const l=await getJSON(`http://127.0.0.1:${port}/json/list`);target=l.find(t=>t.type==='page'&&t.url.startsWith('about:'))||l.find(t=>t.type==='page');if(target)break;}catch{await sleep(150);}}
  if(!target) throw new Error('无 CDP target');
  const ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  const c=new CDP(ws); await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Page.navigate',{url:URL}); await sleep(1400);
  const before=c.events.length;

  // 启动演示（通过欢迎层的"先看演示"）
  await c.eval(`document.getElementById('demoFromWelcome').click()`); await sleep(600);
  await T('演示控制条出现', async ()=>ok(await c.eval(`document.getElementById('demoBar').classList.contains('on')`)));
  await T('封面文字已更新', async ()=>{ const t=await c.eval(`document.getElementById('demoCap').textContent`); ok(t && t.length>8); });

  // 逐步推进到底（每次留出内部 setTimeout 交互的时间，避免快速连点竞态）
  const stepCount = await c.eval(`window.__demoSteps? window.__demoSteps.length : 0`);
  for(let k=1;k<stepCount;k++){ await c.eval(`document.getElementById('demoNext').click()`); await sleep(140); }

  // 校验演示数据独立写入 planloop.demo 且回望有沉淀
  const demo = await c.eval(`(()=>{ const o=JSON.parse(localStorage.getItem('planloop.demo')); if(!o) return null;
    const lastDay=Object.keys(o.dayFills).sort().pop();
    return JSON.stringify({lastDay, hasToday:!!o.dayFills[lastDay], carried:o.carried.length, pinCount:Object.keys(o.pins).length}); })()`);
  console.log('  demo 状态:', demo);
  await T('演示写入到 planloop.demo 且含固定钉/顺延', ()=>{ const d=JSON.parse(demo); ok(d && d.pinCount===5); ok(d.carried>=1); });

  // 退出演示
  await c.eval(`document.getElementById('demoExit').click()`); await sleep(200);
  await T('退出后控制条隐藏', async ()=>ok(!(await c.eval(`document.getElementById('demoBar').classList.contains('on')`))));
  await T('用户真实数据(planloop.v3)未被演示污染', async ()=>{ const u=JSON.parse(await c.eval(`localStorage.getItem('planloop.v3')||'{}'`)); eq(Object.keys(u.dayFills||{}).filter(k=>k>='2020-01-01').length, 0); });

  await sleep(200);
  const errs=c.events.slice(before).filter(e=>e.method==='Runtime.exceptionThrown').map(e=>(e.params.exceptionDetails.exception&&e.params.exceptionDetails.exception.description)||e.params.exceptionDetails.text);
  if(errs.length) console.log('  异常明细:\n'+errs.join('\n'));
  await T('演示全程无 JS 异常', ()=>eq(errs,[]));

  ws.close(); chrome.kill();
  console.log(`\nDEMO SMOKE 通过 ${pass}, 失败 ${fail}`); process.exit(fail?1:0);
}
main().catch(e=>{console.error('冒烟失败:',e.message);process.exit(1);});
setTimeout(()=>{console.error('看门狗超时');process.exit(4);},60000);