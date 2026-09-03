// PlanLoop v3 无头 CDP 冒烟：加载页面、收集 console 异常、驱动关键交互、多视图截图
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_smoke_tmp');
const URL = 'file:///' + path.join(ROOT, 'planloop.html').replace(/\\/g, '/');

function findBrowser(){
  const cands = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function getJSON(url){ return new Promise((res, rej) => http.get(url, r => { let d=''; r.on('data', c=>d+=c); r.on('end',()=>res(JSON.parse(d))); }).on('error', rej)); }

class CDP {
  constructor(ws){ this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)){ const {res,rej}=this.pending.get(m.id); this.pending.delete(m.id); m.error?rej(new Error(m.error.message)):res(m.result); } else if (m.method) this.events.push(m); }); }
  send(method, params={}){ const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, {res,rej}); this.ws.send(JSON.stringify({id, method, params})); }); }
  async eval(expr){ const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('JS异常: '+JSON.stringify(r.exceptionDetails.exception)); return r.result && r.result.value; }
}

async function main(){
  fs.mkdirSync(OUT, { recursive: true });
  const bin = findBrowser();
  if (!bin){ console.log('SKIP: 未找到 Chrome/Edge'); process.exit(2); }
  console.log('浏览器:', bin);

  const port = 9333 + Math.floor(Math.random() * 500);
  const profile = path.join(OUT, 'profile');
  const chrome = spawn(bin, [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', '--window-size=820,1100', 'about:blank'], { stdio: 'ignore' });

  let target;
  for (let i = 0; i < 40; i++){ try { const l = await getJSON(`http://127.0.0.1:${port}/json/list`); target = l.find(t => t.type === 'page' && t.url.startsWith('about:')) || l.find(t => t.type === 'page'); if (target) break; } catch { await sleep(150); } }
  if (!target) throw new Error('无法连接 CDP');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const c = new CDP(ws);
  console.log('ws 已连接');
  await c.send('Page.enable'); await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 1100, deviceScaleFactor: 2, mobile: false });
  console.log('Page/Runtime/Emulation enabled');

  await c.send('Page.navigate', { url: URL });
  console.log('已导航,等待加载');
  await sleep(1800);
  console.log('▲ diag location/status:');
  try { const loc = await c.eval(`location.href + ' | ready=' + document.readyState + ' | body=' + document.body.innerText.slice(0,80).replace(/\\s+/g,' ')`); console.log('  ', String(loc)); } catch(e){ console.log('  (eval失败) '+e.message); }
  console.log('开始交互冒烟');

  const errors = [];
  c.events.forEach(e => { if (e.method === 'Runtime.exceptionThrown'){ errors.push(JSON.stringify(e.params.exceptionDetails)); } if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'){ errors.push(e.params.entry.text); } });
  await c.send('Log.enable');
  const before = c.events.length;

  const shot = async name => {
    try { await Promise.race([ c.send('Page.captureScreenshot', { format: 'png' }).then(r => fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'))), sleep(9000).then(()=>{ throw new Error('截图超时 '+name); }) ]); console.log('📷 ' + name); }
    catch (e) { console.warn('⚠️ 截图跳过(' + name + '): ' + e.message); } };

  // 1. 今日（含欢迎层遮挡）→ 先关闭欢迎
  await shot('01-welcome');
  await c.eval(`document.getElementById('welcomeGo').click()`);
  await shot('02-today');

  // 2. 展开某个时段候选池并点选
  const hasFills = await c.eval(`(function(){ const b=document.querySelector('[data-open]'); if(!b)return false; b.click(); const btn=document.querySelector('[data-pick]'); if(btn){ btn.click(); } else { const inp=document.querySelector('[data-newin]'); inp.value='专注写作'; inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); } return true; })()`);
  console.log('候选/新增填充执行:', hasFills);
  await shot('03-after-fill');

  // 3. 完成该块
  await c.eval(`document.querySelector('[data-tog]').click()`);
  await shot('04-complete');

  // 4. 顺延该块
  await c.eval(`document.querySelector('[data-carry]').click()`);
  await shot('05-carry');
  await c.eval(`document.querySelector('[data-carryto]').click()`);

  // 5. 回望视图
  await c.eval(`document.querySelector('[data-view="look"]').click()`);
  await c.eval(`document.querySelector('#moodRow .mood[data-m="3"]').click()`);
  await shot('06-lookback');

  // 6. 结构视图
  await c.eval(`document.querySelector('[data-view="struct"]').click()`);
  await shot('07-structure');

  // 7. 深色主题
  await c.eval(`document.getElementById('themeBtn').click()`);
  await shot('08-dark');

  await sleep(200);
  c.events.slice(before).forEach(e => { if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.text); if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') errors.push(e.params.entry.text); });

  // 持久后的状态抽查
  const stored = await c.eval(`(()=>{ try{ const o=JSON.parse(localStorage.getItem('planloop.v3')); const d=o.dayFills[Object.keys(o.dayFills)[0]]; return JSON.stringify({carried:o.carried.length,mood:(d&&d.lookback&&d.lookback.mood)}); }catch(e){ return 'ERR '+e.message; } })()`);
  console.log('localStorage 状态:', stored);

  console.log('\n Console/异常: ' + (errors.length ? '\n  - ' + errors.join('\n  - ') : '无'));

  ws.close(); chrome.kill();
  console.log('\nSMOKE ' + (errors.length ? 'FAIL' : 'OK'));
  process.exit(errors.length ? 1 : 0);
}
main().catch(e => { console.error('冒烟失败:', e.message); process.exit(1); });
setTimeout(() => { console.error('超时看门狗触发，强制退出'); process.exit(4); }, 90000);