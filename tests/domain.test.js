// PlanLoop DOM-CORE 领域纯度测试（v3 轻量人生节奏）
// 从 planloop.html 提取 /*==DOM:CORE==*/ ... /*==DOM:GLUE==*/ 间的纯函数层，挂到 Node 跑单测。
const fs = require('fs'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'planloop.html'), 'utf8');
const m = HTML.match(/\/\*==DOM:CORE==\*\/\s*([\s\S]*?)\/\*==DOM:GLUE==\*\//);
if (!m) { console.error('未能定位 DOM:CORE 区块'); process.exit(1); }
const Core = new Function(m[1] + '\n; return Core;')();

let pass = 0, fail = 0;
function T(name, fn){ try { fn(); pass++; } catch (e) { fail++; console.error('✗ ' + name + '\n   ' + e.message); } }
function eq(got, want){ if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error('期望 ' + JSON.stringify(want) + '，实得 ' + JSON.stringify(got)); }
function ok(v){ if (!v) throw new Error('断言失败'); }

// ---------- 结构 ----------
T('defaultSlots 返回 5 个自然时段', () => {
  eq(Core.defaultSlots().map(s => s.name), ['上午', '午间', '下午', '晚上', '午夜']);
});
T('todaySlotHint 按钟点窗口命中时段', () => {
  const slots = Core.defaultSlots();
  // 10:00 => 上午(06-12)
  ok(Core.todaySlotHint(10, slots) === slots[0].id);
  // 20:00 => 晚上(18-22)
  ok(Core.todaySlotHint(20, slots) === slots[3].id);
  // 00:30 => 午夜(22-06 跨天)
  ok(Core.todaySlotHint(0.5, slots) === slots[4].id);
});

// ---------- 候选池：钉 + 最近/高频 + 顺延，钉优先、同文本去重 ----------
T('candidatesFor 钉优先、同文本去重、含最近', () => {
  const dstrNow = '2026-09-03';
  const s1 = 's1';
  const state = {
    v: 3, slots: Core.defaultSlots(), carried: [],
    pins: { s1: [{ id: 'p', text: '晨跑' }] },
    dayFills: { '2026-09-02': { slots: { s1: { text: '晨跑', completed: true } } },   // 与钉相同 → 去重只占一格
                  '2026-09-01': { slots: { s1: { text: '写作', completed: false } } } }, // 最近
  };
  const c = Core.candidatesFor(s1, dstrNow, state);
  eq(c.map(x => x.text), ['晨跑', '写作']);
  eq(c[0].kind, 'pin');
  eq(c[1].kind, 'hot');
});
T('candidatesFor 纳入顺延项（只呈现目标时段与到期日）', () => {
  const dstrNow = '2026-09-03';
  const s1 = 's1';
  const state = { v: 3, slots: [], pins: {}, carried: [
    { id: 'c1', text: '交方案', toSlot: s1, toDay: '2026-09-03' },   // 已到 → 出现
    { id: 'c2', text: '未到', toSlot: s1, toDay: '2026-09-05' },     // 未到 → 不出现
    { id: 'c3', text: '别时段', toSlot: 's2', toDay: '2026-09-03' }  // 别的时段
  ], dayFills: {} };
  eq(Core.candidatesFor(s1, dstrNow, state).map(x => x.text), ['交方案']);
});

// ---------- 填充与执行 ----------
T('pickFill 写入当日该时段内容', () => {
  const state = { v: 3, slots: [], pins: {}, dayFills: {}, carried: [] };
  Core.pickFill(state, '2026-09-03', 's1', '晨跑');
  eq(state.dayFills['2026-09-03'].slots.s1.text, '晨跑');
});
T('pickFill 选中顺延项即消费（不重复）', () => {
  const state = { v: 3, slots: [], pins: {}, carried: [{ id: 'c', text: '交方案', toSlot: 's1', toDay: '2026-09-03' }], dayFills: {} };
  Core.pickFill(state, '2026-09-03', 's1', '交方案');
  ok(state.carried.length === 0);
});
T('completeSlot 二态切换', () => {
  const state = { v: 3, slots: [], pins: {}, dayFills: {}, carried: [] };
  Core.pickFill(state, '2026-09-03', 's1', '晨跑');
  eq(Core.completeSlot(state, '2026-09-03', 's1'), true);
  eq(Core.completeSlot(state, '2026-09-03', 's1'), false);
  eq(state.dayFills['2026-09-03'].slots.s1.completed, false);
});
T('carry 生成顺延项到目标时段', () => {
  const state = { v: 3, slots: [], pins: {}, carried: [], dayFills: {} };
  Core.pickFill(state, '2026-09-03', 's1', '晨跑');
  Core.carry(state, '2026-09-03', 's1', '2026-09-04', 's2');
  eq(state.carried.length, 1);
  eq(state.carried[0].text, '晨跑');
  eq(state.carried[0].toSlot, 's2');
  eq(state.carried[0].toDay, '2026-09-04');
});
T('carry 空时段返回 null 不产生条目', () => {
  const state = { v: 3, slots: [], pins: {}, carried: [], dayFills: {} };
  eq(Core.carry(state, '2026-09-03', 's1', '2026-09-04', 's2'), null);
  eq(state.carried.length, 0);
});
T('countCompletedOfDay 统计', () => {
  const state = { v: 3, slots: [], pins: {}, carried: [], dayFills: {} };
  Core.pickFill(state, '2026-09-03', 's1', 'a'); Core.completeSlot(state, '2026-09-03', 's1');
  Core.pickFill(state, '2026-09-03', 's2', 'b');
  eq(Core.countCompletedOfDay(state.dayFills, '2026-09-03'), { done: 1, total: 2 });
});

// ---------- 回望沉淀（正向量） ----------
T('streak 连续天数（含今天）', () => {
  const df = {
    '2026-09-03': { slots: { s: { text: 'x', completed: true } } },
    '2026-09-02': { slots: { s: { text: 'x', completed: true } } },
    '2026-09-01': { slots: { s: { text: 'x', completed: false } } },
  };
  eq(Core.streak(df, '2026-09-03'), 2);
});
T('cumCompleted / last7 正确', () => {
  const df = { '2026-09-03': { slots: { s: { text: 'x', completed: true } } }, '2026-09-02': { slots: { s: { text: 'x', completed: true } } } };
  eq(Core.cumCompleted(df), 2);
  const w7 = Core.last7(df, '2026-09-03');
  eq(w7.length, 7);
  eq(w7[6].done, 1); // 最后一天 = 今天
});

// ---------- 序列化 / 迁移 ----------
T('export/validate 往返一致', () => {
  const state = { v: 3, slots: Core.defaultSlots(), pins: {}, dayFills: {}, carried: [], settings: {} };
  const json = Core.exportState(state);
  ok(Core.validateState(JSON.parse(json)));
});
T('parseImport v3 识别、无效 JSON 拒绝', () => {
  ok(Core.parseImport(JSON.stringify({ v: 3, slots: [], dayFills: {}, pins: {}, carried: [] })) !== null);
  eq(Core.parseImport('not-json'), null);
});
T('migrateFromV2 映射旧块与待办池', () => {
  const v2 = { v: 2, templates: [], days: { '2026-09-01': { blocks: [
    { name: '上午', taskName: '写周报', status: 'done' }, { name: '上午', taskName: '晨跑', status: 'pending' } ] } },
    backlog: [{ taskName: '拖到的活' }] };
  const v3 = Core.migrateFromV2(v2);
  eq(v3.v, 3);
  ok(v3.dayFills['2026-09-01']); // 空 slots 由 pickFill 兜底
  ok(v3.carried.length === 1);
});

console.log(`\nDOM 域测试：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);