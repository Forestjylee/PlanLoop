"use strict";
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'planloop.html'),
  'utf8'
);
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('FAIL: no <script> block found'); process.exit(1); }
const script = scriptMatch[1];
const coreMatch = script.match(/\/\*==DOM:CORE==\*\/([\s\S]*?)\/\*==DOM:GLUE==\*\//);
if (!coreMatch) { console.error('FAIL: CORE sentinels not found'); process.exit(1); }
const core = coreMatch[1];

const api = new Function(
  core + '\n return { createDomain, tplApplies, repeatLabel, blocksFromTemplates, clampStart, hmToMin, minToHM, normMood, mdToHtml };'
)();

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log(' FAIL ' + name); }
}

function freshState() {
  return {
    v: 2,
    templates: [
      { id: 't1', name: '晨间', start: '07:00', end: '08:30', color: '#f00',
        repeat: 'weekday', customDays: [], createdAt: 'now' },
      { id: 't2', name: '周末', start: '09:00', end: '10:00', color: '#0f0',
        repeat: 'weekend', customDays: [], createdAt: 'now' },
      { id: 't3', name: '自定义', start: '11:00', end: '11:30', color: '#00f',
        repeat: 'custom', customDays: [1, 3, 5], createdAt: 'now' },
      { id: 't4', name: '每天', start: '12:00', end: '12:30', color: '#ff0',
        repeat: 'daily', customDays: [], createdAt: 'now' }
    ],
    days: {},
    backlog: [],
    settings: { theme: 'light' }
  };
}

console.log('--- 1. tplApplies ---');
{
  const dom = api.createDomain(freshState());
  // daily
  check('daily on weekday true', api.tplApplies({ repeat: 'daily' }, '2026-08-21') === true); // Friday
  check('daily on weekend true', api.tplApplies({ repeat: 'daily' }, '2026-08-22') === true); // Saturday
  // weekday
  check('weekday on Monday true', api.tplApplies({ repeat: 'weekday' }, '2026-08-24') === true); // Monday
  check('weekday on Saturday false', api.tplApplies({ repeat: 'weekday' }, '2026-08-22') === false); // Saturday
  // weekend
  check('weekend on Saturday true', api.tplApplies({ repeat: 'weekend' }, '2026-08-22') === true); // Saturday
  check('weekend on Wednesday false', api.tplApplies({ repeat: 'weekend' }, '2026-08-26') === false); // Wednesday
  // custom
  check('custom [1,3,5] on Monday true', api.tplApplies({ repeat: 'custom', customDays: [1, 3, 5] }, '2026-08-24') === true); // Monday=1
  check('custom on Tuesday false', api.tplApplies({ repeat: 'custom', customDays: [1, 3, 5] }, '2026-08-25') === false); // Tuesday=2
}

console.log('--- 2. repeatLabel ---');
{
  check('daily label', /每天/.test(api.repeatLabel({ repeat: 'daily' })));
  check('custom label has 每周', /每周/.test(api.repeatLabel({ repeat: 'custom' })));
  check('weekday label ok', typeof api.repeatLabel({ repeat: 'weekday' }) === 'string' && api.repeatLabel({ repeat: 'weekday' }).length > 0);
}

console.log('--- 3. blocksFromTemplates snapshot ---');
{
  const st = freshState();
  // '2026-08-24' Monday: weekday(t1,yes) custom(t3 yes) daily(t4 yes) weekend(no)
  const blocks = api.blocksFromTemplates(st.templates, '2026-08-24');
  check('hit count = 3', blocks.length === 3);
  const first = blocks[0];
  check('snapshot has name/start/end/color', !!(first.name && first.start && first.end && first.color));
  st.templates[0].name = '改了';
  st.templates[0].color = '#111';
  check('id not same as template id', first.id !== st.templates[0].id);
  check('snapshot unaffected by template change', first.name !== '改了' && first.color !== '#111');
  check('taskName empty', first.taskName === '');
  check('est = minutesOf', typeof first.est === 'number' && first.est > 0);
}

console.log('--- 4. ensureToday materializes once ---');
{
  const st = freshState();
  const dom = api.createDomain(st);
  dom.ensureToday();
  const today = dom.todayStr();
  const hitExpected = st.templates.filter(t => api.tplApplies(t, today)).length;
  check('days has today', !!st.days[today]);
  check('today blocks = matching template count', st.days[today].blocks.length === hitExpected);
  const dom2 = api.createDomain(st);
  dom2.ensureToday();
  check('not re-materialized (blocks unchanged)', st.days[today].blocks.length === hitExpected);
}

console.log('--- 5. invariant a: materialized day unaffected by template change ---');
{
  const st = freshState();
  const dom = api.createDomain(st);
  // materialize Monday
  const monday = '2026-08-24';
  dom.writeBlock(monday, '__init__', {}); // forces materialization
  const t1Blk = st.days[monday].blocks.find(b => b.name === '晨间').id;
  dom.writeBlock(monday, t1Blk, { taskName: 'x' });
  const before = JSON.stringify(st.days[monday]);
  st.templates[0].name = '改名';
  st.templates[0].color = '#999';
  st.templates[1].name = '删我';
  const after = JSON.stringify(st.days[monday]);
  check('snapshot blocks unchanged after template edit', before === after);
  const block = st.days[monday].blocks.find(b => b.taskName === 'x');
  check('block still has old name', block && block.name === '晨间' && block.color === '#f00');
}

console.log('--- 6. invariant b: deleting template keeps materialized snapshot ---');
{
  const st = freshState();
  const dom = api.createDomain(st);
  const monday = '2026-08-24';
  st.templates.push({ id: 'tmp-del', name: '将删', start: '20:00', end: '21:00', color: '#abc', repeat: 'custom', customDays: [1], createdAt: 'now' });
  dom.writeBlock(monday, '__init__', {}); // forces materialization
  const delBlk = st.days[monday].blocks.find(b => b.name === '将删').id;
  dom.writeBlock(monday, delBlk, { taskName: 'y' });
  check('block present before delete', !!st.days[monday].blocks.find(b => b.name === '将删'));
  st.templates = st.templates.filter(t => t.id !== 'tmp-del');
  check('materialized day still keeps deleted template snapshot', !!st.days[monday].blocks.find(b => b.name === '将删'));
}

console.log('--- 7. invariant c: un-materialized future day projects new template ---');
{
  const st = freshState();
  const dom = api.createDomain(st);
  const future = dom.addDays('2026-08-24', 1); // Tuesday
  const before = dom.projectBlocks(future);
  const beforeCount = before.length;
  st.templates.push({ id: 't-new', name: '新增', start: '22:00', end: '23:00', color: '#777', repeat: 'daily', customDays: [], createdAt: 'now' });
  const after = dom.projectBlocks(future);
  check('future projection reflects new template', after.length === beforeCount + 1);
  check('no materialized entry created for future day', !st.days[future]);
}

console.log('--- 8. writeBlock lazy materialization ---');
{
  const st = freshState();
  const dom = api.createDomain(st);
  const future = dom.addDays('2026-08-24', 5); // Saturday
  const bogusId = 'nonexistent';
  const r = dom.writeBlock(future, bogusId, { taskName: 'z' });
  check('writeBlock to missing block returns false', r === false);
  check('future day materialized on first write', !!st.days[future]);
  const dBlk = st.days[future].blocks.find(b => b.name === '每天').id;
  const ok = dom.writeBlock(future, dBlk, { taskName: '写在未来' });
  check('writeBlock to materialized block hits', ok === true);
  const blk = st.days[future].blocks.find(b => b.id === dBlk);
  check('block patched', blk && blk.taskName === '写在未来');
}

console.log('--- 9. addToBacklog ---');
{
  const st = freshState();
  const dom = api.createDomain(st);
  const monday = '2026-08-24';
  dom.writeBlock(monday, '__init__', {}); // forces materialization
  const t4Blk = st.days[monday].blocks.find(b => b.name === '每天').id;
  dom.writeBlock(monday, t4Blk, { taskName: '' });
  const noRes = dom.addToBacklog(monday, t4Blk);
  check('empty taskName returns null', noRes === null);
  check('backlog unchanged on empty', st.backlog.length === 0);
  dom.writeBlock(monday, t4Blk, { taskName: '待办内容', note: '备注', est: 30 });
  const entry = dom.addToBacklog(monday, t4Blk);
  check('entry returned', !!entry && entry.taskName === '待办内容' && entry.srcDate === monday);
  check('backlog grew', st.backlog.length === 1);
  check('block carrySent set true', st.days[monday].blocks.find(b => b.id === t4Blk).carrySent === true);
}

console.log('--- 10. assignFromBacklog ---');
{
  const st = freshState();
  const dom = api.createDomain(st);
  const monday = '2026-08-24';
  const tuesday = '2026-08-25';
  dom.writeBlock(monday, '__init__', {}); // forces materialization
  const t4Blk = st.days[monday].blocks.find(b => b.name === '每天').id;
  dom.writeBlock(monday, t4Blk, { taskName: '遗留任务', note: 'n', est: 40 });
  const entry = dom.addToBacklog(monday, t4Blk);
  const bad = dom.assignFromBacklog(entry.id, tuesday, 'does-not-exist');
  check('assign to missing block returns false', bad === false);
  const t1Blk = st.days[tuesday].blocks.find(b => b.name === '晨间').id;
  const good = dom.assignFromBacklog(entry.id, tuesday, t1Blk);
  check('assign returns true', good === true);
  const target = st.days[tuesday].blocks.find(b => b.id === t1Blk);
  check('target block got taskName', target && target.taskName === '遗留任务' && target.note === 'n' && target.est === 40);
  check('entry status done', st.backlog.find(e => e.id === entry.id).status === 'done');
}

console.log('--- 11. export/import ---');
{
  const st = freshState();
  const dom = api.createDomain(st);
  dom.ensureToday();
  const t4Blk = st.days[dom.todayStr()].blocks.find(b => b.name === '每天').id;
  dom.writeBlock(dom.todayStr(), t4Blk, { taskName: '数据' });
  const json = dom.exportState();
  const st2 = freshState();
  const dom2 = api.createDomain(st2);
  const ok = dom2.importState(json);
  check('validJson replaces state, returns true', ok === true);
  check('imported data intact', dom2.getMaterialized(dom.todayStr()) && dom2.getMaterialized(dom.todayStr()).blocks.filter(b => b.taskName === '数据').length === 1);

  const badJson = dom2.importState('{{{');
  check('bad JSON returns false', badJson === false);

  const badVersion = JSON.stringify(Object.assign({}, JSON.parse(json), { v: 3 }));
  check('version mismatch returns false', dom2.importState(badVersion) === false);

  const parsed = JSON.parse(json);
  delete parsed.backlog;
  check('missing field returns false', dom2.importState(JSON.stringify(parsed)) === false);

  check('state still intact after failed imports', !!dom2.getMaterialized(dom.todayStr()));
}

console.log('--- 12. clampStart (CR-003) ---');
(function () {
  check('normal range keeps value', api.clampStart(120, 90) === 120);
  check('clamps to 1440-dur when tail overflows', api.clampStart(1400, 90) === 1350);
  check('negative start clamped to 0', api.clampStart(-30, 90) === 0);
  check('zero-start allowed', api.clampStart(0, 1440) === 0);
  check('overnight block dur<=0 untouched', api.clampStart(1200, -60) === 1200);
  check('full-day tail boundary exact', api.clampStart(1440, 0) === 1440);
}());

console.log('--- 13. normMood (CR-010) ---');
(function () {
  check('0 stays 0', api.normMood(0) === 0);
  check('1 (bad) stays 1', api.normMood(1) === 1);
  check('2 maps to 1', api.normMood(2) === 1);
  check('3 maps to 2', api.normMood(3) === 2);
  check('4 maps to 3', api.normMood(4) === 3);
  check('5 maps to 3', api.normMood(5) === 3);
}());

console.log('--- 14. mdToHtml (CR-010) ---');
(function () {
  var h1 = api.mdToHtml('# 标题');
  check('h1 heading', h1.indexOf('<h1>标题</h1>') !== -1);
  var h2 = api.mdToHtml('## 子标题');
  check('h2 heading', h2.indexOf('<h2>子标题</h2>') !== -1);
  var ul = api.mdToHtml('- apple\n- banana');
  check('unordered list', ul.indexOf('<ul>') !== -1 && ul.indexOf('<li>apple</li>') !== -1 && ul.indexOf('<li>banana</li>') !== -1);
  var ol = api.mdToHtml('1. first\n2. second');
  check('ordered list', ol.indexOf('<ol>') !== -1 && ol.indexOf('<li>first</li>') !== -1);
  var b = api.mdToHtml('**加粗**');
  check('bold inline', b.indexOf('<strong>加粗</strong>') !== -1);
  var code = api.mdToHtml('`code`');
  check('inline code', code.indexOf('<code>code</code>') !== -1);
  var p = api.mdToHtml('普通段落');
  check('plain paragraph', p.indexOf('<p>普通段落</p>') !== -1);
  var xss = api.mdToHtml('<script>alert(1)</script>');
  check('XSS escaped, no raw script tag', xss.indexOf('<script>') === -1 && xss.indexOf('&lt;script&gt;') !== -1);
  check('empty input -> empty string', api.mdToHtml('') === '');
}());

console.log('');
console.log('PASS ' + pass + ' / FAIL ' + fail);
if (fail > 0) process.exitCode = 1;