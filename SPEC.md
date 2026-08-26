# PlanLoop MVP 技术规格与实现计划 (SPEC)

> 状态：按此实现前请评审 ｜ 上游：[PRD.md](PRD.md)（需求） 、[CONTEXT.md](CONTEXT.md)（术语） 、[PROCESS_LOG.md](PROCESS_LOG.md)（决策）
> 三条领域不变量（PRD §3）是数据层硬约束，必须成立且有测试兜底。

**目标**：做出一个自用的本地优先单文件 Web 应用，实现"结构固定 + 每日填充 + 执行记录 + 复盘 + 遗留待办池"闭环。
**架构**：单文件 `planloop.html`，JS 分两层——**领域纯函数层**(无 DOM，可被 Node 测试)与 **DOM 胶水层**(渲染与事件)。数据存 localStorage。
**技术栈**：原生 HTML/CSS/JS（零依赖、零构建），Node 内置能力做领域逻辑测试。

---

## 1 文件规划

| 文件 | 职责 |
|---|---|
| `planloop.html` | 全部交付物：领域纯函数层（可测） + DOM 胶水层 + 样式。单文件，双击浏览器即用。 |
| `tests/domain.test.js` | Node 脚本：从 `planloop.html` 抽取领域纯函数层，跑领域不变量与核心逻辑断言。 |
| `README.md` | 用法与测试命令（选用，如需要） |

测试怎么读代码：`tests/domain.test.js` 用正则把 `<script>` 内的、由哨兵注释 `/*==DOM:CORE==*/` 与 `/*==DOM:GLUE==*/` 包裹的领域层取出，`new Function` 包一层暴露到 `module.exports`，再断言。

---

## 2 数据模型（localStorage 键 `planloop.v2`）

```js
state = {
  v: 2,
  templates: [ { id, name, start:"10:00", end:"12:00", color, repeat:"daily|weekday|weekend|custom", customDays:[0..6], createdAt } ],
  days: { "YYYY-MM-DD": DayRecord },   // 仅已物化的日子存在
  backlog: [ { id, srcDate, srcBlock, taskName, note, est, status:"open" } ],
  settings: { theme:"light|dark" }
}
DayRecord = {
  blocks: [ { id, name, start, end, color,   // ← 结构快照字段（嵌入当日，与模板解耦）
              taskName, note, est, as, ae, status:"", carrySent:false } ],
  review: { text:"", mood:0 }
}
```

不变量实现要点：
- **只有"已物化"的日子才存在于 `days`**。物化 = 成为今天，或首次被写入内容。模板增删改天然只影响"未物化的未来日"（它们走实时投影），不会碰已物化的 `days` 记录——三条不变量由"命中集合"直接保证。
- 模板编辑/删除不回溯：因为已物化日存的是快照字段，与模板无引用。
- 未来未物化日显示实时投影（读模板），点进去/写入时才物化。

---

## 3 领域纯函数层接口（可测）

```js
// 时间：纯
function dstr(d); parseD(s); addDays(s,n); todayStr();
// 结构匹配：纯
function tplApplies(t, dayStr) -> bool
function repeatLabel(t) -> string
// 骨骼→当日块（物化时快照）：纯
function blocksFromTemplates(templates, dayStr) -> Block[]   // 每个块 snapshot 模板字段 + 空 taskName
// 日记录访问（半纯，依赖 state）
function getMaterialized(dayStr) -> DayRecord|null
function ensureToday() -> void    // 今天未物化则物化并落库
function writeBlock(dayStr, blockId, patch) -> void  // 首次写 => 先物化再写（惰性物化）
function projectBlocks(dayStr) -> Block[]  // 已物化取记录，未物化取实时投影（只读）
// 待办池：半纯
function addToBacklog(srcDate, srcBlockId) -> Entry|null  // 校验 taskName 非空
function assignFromBacklog(entryId, dayStr, blockId) -> bool  // 写入该日计划块，标 done
// 序列化
function exportState() -> string(JSON); importState(json) -> bool; parseImport(json)
```

---

## 4 任务清单（TDD）

> 每任务：先写失败测试 → 确认失败 → 实现 → 确认通过 → 提交。命令统一：`node tests/domain.test.js`（退出码 0=全过）。

### 任务 1：结构匹配 (tplApplies)
**Files:** Create `planloop.html`（结构+哨兵+`tplApplies`/`repeatLabel`）、Create `tests/domain.test.js`

- [ ] Step 1：写测试——daily 任意天 true；weekday 仅周一~五；weekend 仅六日；custom 按 customDays。
- [ ] Step 2：跑 `node tests/domain.test.js` → 期望 FAIL（BE/哨兵未建）。
- [ ] Step 3：在 `planloop.html` 领域层实现 `tplApplies`、`repeatLabel`、日期纯函数。
- [ ] Step 4：跑测试 → PASS。
- [ ] Step 5：提交 `feat: skeleton day matching`。

### 任务 2：一天物化与快照解耦
**Files:** `planloop.html`、`tests/domain.test.js`

- [ ] Step 1：测试——`blocksFromTemplates` 输出的 block 快照了 name/start/end/color；改动模板对象后快照不变。
- [ ] Step 2：跑 → FAIL。
- [ ] Step 3：实现 `blocksFromTemplates`、`getMaterialized`、`ensureToday`（今天物化一次）。
- [ ] Step 4：跑 → PASS。
- [ ] Step 5：提交 `feat: day materialization snapshot`。

### 任务 3：惰性物化 & 只影响未来（不变量兜底）
**Files:** `planloop.html`、`tests/domain.test.js`

- [ ] Step 1：测试三条不变量——
  (a) 模板改色/名 → 已物化日的块不变；
  (b) 删除模板 → 已物化日仍含该块；
  (c) 未物化未来日 `projectBlocks` 反映最新模板。
- [ ] Step 2：跑 → FAIL。
- [ ] Step 3：实现 `writeBlock`（首写先物化）、`projectBlocks`（未物化走模板投影）。
- [ ] Step 4：跑 → PASS。
- [ ] Step 5：提交 `feat: lazy materialization invariants`。

### 任务 4：待办池收容与取用
**Files:** `planloop.html`、`tests/domain.test.js`

- [ ] Step 1：测试——`addToBacklog` 空 taskName 拒绝；分配后条目转 done 且写入目标日块。
- [ ] Step 2：跑 → FAIL。
- [ ] Step 3：实现 `addToBacklog`、`assignFromBacklog`。
- [ ] Step 4：跑 → PASS。
- [ ] Step 5：提交 `feat: backlog pool carry`。

### 任务 5：序列化 导出/导入
**Files:** `planloop.html`、`tests/domain.test.js`

- [ ] Step 1：测试——`exportState`→`importState` 往返无损；坏 JSON 返回 false 且不污染现有数据。
- [ ] Step 2：跑 → FAIL。
- [ ] Step 3：实现 `exportState`、`importState`、`parseImport`（含版本校验）。
- [ ] Step 4：跑 → PASS。
- [ ] Step 5：提交 `feat: export import`。

### 任务 6：DOM 胶水层——今日视图 / 复盘 / 待办池 / 周视图 / 模板管理 / 主题
**Files:** `planloop.html`

- [ ] Step 1：接入领域层，渲染今日时间轴（状态徽章循环切换、任务名即时保存、详情区），顶部"今天/周/复盘/模板"页签。
- [ ] Step 2：复盘页（计划vs实际 + 勾选放进待办池 + 心情 + 复盘框）。
- [ ] Step 3：待办池页签（列表 + 分配到"目标日期/目标块" + 删除）。
- [ ] Step 4：周视图（7 列 + 点击跳转该日）。
- [ ] Step 5：模板管理（增删改 + 重复规则 + 颜色）+ 本地首次种子一个黄金结构。
- [ ] Step 6：导出按钮 / 导入按钮、深色主题持久化。
- [ ] Step 7：手工冒烟（键盘/点按闭环走一遍）＋ `node tests/domain.test.js` 全过。
- [ ] Step 8：提交 `feat: planloop MVP ui`。

### 任务 7：README 与收尾
- [ ] Step 1：写 `README.md`(打开方式、测试命令、与既有原型 planloop.html 的关系)。
- [ ] Step 2：全量测试通过；提交 `docs: readme`。

---

## 6 CR-001 新手引导（Onboarding）实现规格

> 上游：[PRD.md 4.8](PRD.md)（需求）、本次 SPEC 的领域层/胶水层架构。纯 DOM 胶水层改动 + 一个设置字段，不触碰领域纯函数接口；`tests/domain.test.js` 必须保持全绿。

### 6.1 数据模型

- `state.settings.onboarded`（新增布尔，默认无 = falsy）。首次打开时 `!onboarded` → 自动开始导览；关闭导览即置 `true` 并 `persist()`。
- 兼容性：旧存档无此字段（falsy → 会引导一次，可接受）；导出自带、导入随之迁移（`parseImport` 复制整个 `state.settings`，无需改版本号）。

### 6.2 静态资源

- 顶部栏新增常驻「？」按钮 `#onboardBtn`（`iconbtn`，放 `themeBtn` 左侧）。
- 新增 3 个覆盖层样式类：`.tour-veil`（全屏遮罩，`clip-path` 挖洞高亮目标）、`.tour-bubble`（气泡）、内部 `.tour-step`/`.tour-ctr` 按钮区。遮罩 z-index 高于 `.overlay`(50)，低于 `.toast`(99)。

### 6.3 导览引擎（胶水层，5 节点固定顺序）

步骤表（`STEPS`）：目标用选择器 + 文案（对应 PRD 4.8 表格）：

| idx | 选择器（优先→兜底） | 文案要点 |
|---|---|---|
| 0 | `.nav button[data-view="day"]` | 今日主界面，默认落在此 |
| 1 | `.statchip`（首个）→`#daySummary` | 点徽章循环切换执行状态 |
| 2 | `.nav button[data-view="review"]` | 每天结束「计划 vs 实际」，未完成放进待办池 |
| 3 | `.nav button[data-view="backlog"]` | 跨日未决任务暂存，次日取用分配 |
| 4 | `.nav button[data-view="templates"]` | 时间块结构一次搭好，之后每天只填内容 |

- 状态变量：`tourIdx`（-1=未开）、`tourFromBtn`（手动重开标记）。
- 位置：每步计算目标 `getBoundingClientRect()`，遮罩 `clip-path` 挖对应矩形洞（含 4px 内边距），气泡固定定位放在目标旁（优先下方，空间不足转上方/左右就近）。
- 重定位：绑定 `window` 的 `resize` 与 `scroll`（capture）重算当前步；步骤切换走 `switchStep` 统一重算。
- 计数：`tourIdx` 从 0 递增；`下一步` 到最后一节点变「完成」；`上一步` 到 0 禁用；`跳过所有` 直接关。
- 关闭（任何方式：点外 / Esc / 跳过 / 完成，或到达终点）→ `finishTour()`：置 `settings.onboarded = true`、`persist()`、移除遮罩与气泡、解绑监听。
- 触发：`DOMContentLoaded` 渲染完成后再 `if (!state.settings.onboarded) startTour()`；`#onboardBtn` 点击 → `startTour()`（重播从头，不改 onboarded）。

### 6.4 演示约束（对齐 PRD）

- 导览为纯展示：不调用 `switchView`（节点只高亮常驻导航按钮与首屏徽章，无需切页），避免惰性物化副作用。
- 兜底：无 `.statchip` 时回退高亮 `#daySummary`，文案不变。
- 遮罩不拦截非目标区域的业务交互，但因高亮全程遮罩，Alt 方案（极端窗口文案指引）不做额外代码——文案本身自带指引。

### 6.5 自检

- `node tests/domain.test.js` 全绿（无领域层改动）。
- 手动：清空 localStorage 首次打开 → 自动弹导览；走完/关闭后刷新不再弹；点「？」从头重播且刷新不自动弹。

---

## 5 自检对照（spec→PRD 覆盖）

- 4.1 结构管理 → 任务 1 + 6-5
- 4.2 今日视图/执行 → 任务 6-1
- 4.3 复盘 → 任务 6-2
- 4.4 遗留待办池 → 任务 4 + 6-3
- 4.5 周视图 → 任务 6-4
- 4.6 导出/导入 → 任务 5 + 6-6
- 4.7 主题/本地存储 → 任务 6-6
- 三条不变量 + 数据层测试兜底 → 任务 2/3 + 持续回归

---

## 8 CR-003 今日时间轴视图 + 拖拽（实现规格）

> 上游：[PRD.md 4.9](PRD.md)。纯 DOM 胶水层渲染+交互改动；领域纯函数层新增一个可测纯函数 **`clampStart(startMin, durMin) -> number`**（起始分钟夹在 `[0, 1440-dur]`），其余不触碰既有接口；`tests/domain.test.js` 保持全绿。

### 8.1 领域层新增（纯、可测）

- `clampStart(startMin, durMin)`：`Math.min(startMin, Math.max(0min, 1440-dur))`；`dur<=0`（跨零点）时返回原始 `startMin`（保持当日起始不动，不做领域裁剪）。样式标注：`start`(分钟) 由 `parseD(start)`→时分算。「时段长度」`durMin = (endMin-startMin+1440)%1440`（读快照已有 end，直接用分转分钟差）。

### 8.2 今日视图渲染（替换原垂直卡片列表 `.timeline`)

- 容器 `.daygrid`（相对定位，`height = 1440 * PPM`，`PPM≈0.72px/min`）。
- 左侧刻度列 `.gutter`：每整点一条刻度线 + 标签（0 到 24）。
- 卡片 `.bl` 改为**绝对定位**：`top = startMin*PPM`，`height = durMin*PPM`（跨零点只显示到 24:00 的可见段），`left` 固定于内容区。**去掉卡内起止时间文本**（时间由轴位置表达）。
- 自动滚动：进入今日视图时把窗口滚动到"当前时刻 − 0.35×视口高度"处（每次切回该视图恢复一次）。

### 8.3 拖拽改时段（胶水层）

- 卡片抬头区 `mousedown` → 全屏 `mousemove`：以 `clientY 位移 / PPM` 得分钟增量，`newStart = clampStart( round(origStart+delta → 整点/60) , durMin)`，实时 `writeBlock(dayDate,id,{start:minToHM(newStart)})` 前仅视觉移动并显示吸附时间标签；`mouseup` 落定。**吸附单位=整点（每小时一个槽位）**。
- endDrag 时按 `start / end=start+durMin` 写回并 `persist()`；`duration = end-start` 不变由同时更新 end 保证。
- 视觉反馈：拖动时卡片加 `dragging` 阴影、半透明；时间轴重叠处不避让。

### 8.4 边界

- 跨零点块（`endMin<=startMin`）：渲染段 = `[startMin, 1440]`，高度 = `(1440-startMin)*PPM`。
- 拖拽 `newStart` 经 `clampStart` 夹住到 `[0, 1440-durMin]`，块尾不越当日。
- 重叠：允许并存，不做避让。

### 8.5 自检

- `node tests/domain.test.js` 全绿（新增 `clampStart` 用例 + 既有 45 例）。
- 手动：今日视图呈纵向时间轴、无卡内时间文本；拖动卡片平移时段、高度不变、尾不越界；切走切回保持一致。

---

## 9 CR-009 产品理念开场引导（实现规格）

> 上游：[PRD.md 4.10](PRD.md)。纯 DOM 胶水层 + 样式 + 一个设置标记；`tests/domain.test.js` 保持全绿。

### 9.1 数据模型

- `state.settings.philoIntro`（新增布尔，默认无 = falsy）。首次打开且 `!philoIntro && !onboarded` 时自动播放理念段；看完全部卡片或点「开始使用」即置 `true` 并 `persist()`。
- `readPhilo()` 兼容：旧存档无此字段（falsy → 首次会播一次理念段，可接受）。

### 9.2 静态资源

- 覆盖层样式 `.philo-veil`（全屏遮罩）、`.philo-card`（居中理念卡）。z-index 与导览层一致（60–62 之间）。顶栏无新增按钮（「？」仍只重播操作导览）。

### 9.3 理念引擎（胶水层，3 卡片顺序固定）

- `PHILO_CARDS = [{ t:'把决定提前', c:'…' }, { t:'结构护住黄金时段', c:'…' }, { t:'只影响未来', c:'…' }]`（文案见 PRD 4.10）。
- 状态 `philoIdx`（-1=未开）。
- 每张卡右侧一个「下一步」，最后一张变「开始使用」；卡片底部进度点。
- 点外 / Esc / 「开始使用」→ `finishPhilo()`：置 `settings.philoIntro = true`、`persist()`、移除遮罩；若 `!state.settings.onboarded` 则紧接 `startTour()`。
- 触发：DOM 渲染完成后 `if (!state.settings.philoIntro && !state.settings.onboarded) startPhilo()`。

### 9.4 自检

- `node tests/domain.test.js` 全绿（无领域层改动）。
- 手动：清 localStorage 首次开 → 先理念段再进操作导览；完成后刷新不再弹；老用户（onboarded=true）开新档不含 philo 时只播理念段不播导览。

---

## 10 CR-010 心情 3 档 + 富文本复盘（实现规格）

> 上游：[PRD.md 4.11](PRD.md)。领域层新增可测纯函数 **`mdToHtml(src)`** 与 **`normMood(v)`**；其余为胶水层。

### 10.1 领域层新增（纯、可测）

- `normMood(v)`：把既有 5 档归并到 3 档——`0→0`、`1/2→1`、`3→2`、`4/5→3`。用于读取老存档时归一化展示。
- `mdToHtml(src)`：把 Markdown 子集转 HTML 字符串。纯函数，内部对所有文本先 `esc()` 再套标签（**防 XSS 是硬要求**）。

**Markdown 子集解析规则**：
- 先按 `\n` 分块（`block`）。
- 块级：`# ` / `## ` / `### ` → `<h1/2/3>`；`- `/`* ` 连续块 → `<ul><li>`；`1. ` 连续块 → `<ol><li>`；空块作段分隔。
- 剩余普通行合并为 `<p>`。
- 行内：`` `code` `` → `<code>`；`**bold**` → `<strong>`。文本一律先 `esc`。
- 输出用一个安全子集 sanitize（只允许 `h1-h3/p/ul/ol/li/code/strong`），兜底移除其余标签。

### 10.2 胶水层改动

- **心情**：`#moodRow` 改渲染 3 个按钮（好 🙂 / 中 😐 / 坏 😞），`data-mood="1|2|3"`；保存仍 `mood=1/2/3`。读取展示时先 `normMood(m.review.mood)`。
- **复盘富文本**：
  - `#reviewText` 下方新增 `<button id="revPreviewToggle">预览</button>` 与一个隐藏的预览容器 `#reviewPreview`。
  - 预览态渲染 `mdToHtml(r.text)` 入容器，隐藏 textarea；再点切回编辑（textarea 值保持原状）。
  - 输入监听不变（直接存 Markdown 源码字符串）。

### 10.3 自检

- `node tests/domain.test.js` 全绿（新增 `mdToHtml`、`normMood` 用例）。
- 手动：复盘心情 3 档可点选回显；输入 `# 标题` `- 列表` `**加粗**` 后点预览出对应层级；预览不执行任何脚本标签。