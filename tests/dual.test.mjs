// 对照模式（dualMode）渲染测试：本地资料原文 + LLM 答案并列 + 点选回调。
// 纯 jsdom，不开浏览器。用法：node tests/dual.test.mjs
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SNAP_SRC = fs.readFileSync(path.join(ROOT, 'src/quiz-snapshot.js'), 'utf8');
const BADGE_SRC = fs.readFileSync(path.join(ROOT, 'src/answer-badge.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

const html = fs.readFileSync(path.join(__dirname, 'fixtures/mixed-sections.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.com/quiz' });
const { window } = dom;

window.Element.prototype.getBoundingClientRect = () => ({ width: 200, height: 24, top: 0, left: 0, right: 200, bottom: 24, x: 0, y: 0 });
if (!window.CSS) window.CSS = {};
if (typeof window.CSS.escape !== 'function') window.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (m) => '\\' + m);

window.eval(SNAP_SRC);
window.eval(BADGE_SRC);

const snap = window.QuizSnapshot.takeSnapshot(window.document);
console.log('识别题目:', snap.questions.length);
ok(snap.questions.length > 0, 'fixture 有题目可测');

const doc = window.document;
const badgeApi = window.QuizBadge;

// configure 必须被 dualMode 单独点亮（不依赖 inlineBadge）
const enabled = badgeApi.configure({ inlineBadge: false, dualMode: true });
ok(enabled === true, 'dualMode 单独即可启用徽标载体', 'enabled=' + enabled);

const q = snap.questions[0];
const refs = [
  { docName: '小学语文100题.md', section: '六、古诗文积累', text: '**59.** 补全「欲穷千里目，（　）」。**答：更上一层楼。**', truncated: false },
  { docName: '小学语文100题.md', section: '六、古诗文积累', text: '第二段原文……', truncated: true }
];

let usedLlm = 0, rejected = 0;
const opened = badgeApi.renderDual(doc, q, {
  refs,
  llm: { label: 'B', answer: 'B', reasoning: '因为……' }
}, {
  useLlm: () => { usedLlm++; },
  reject: () => { rejected++; }
});

ok(opened === true, 'renderDual 返回 true');

const badge = doc.querySelector('.qku-dual-badge');
ok(!!badge, '徽标已插入 .qku-dual-badge');
ok(!!badge && !!badge.querySelector('.qku-dual'), '包含 .qku-dual 卡片');
ok(!!badge && badge.textContent.includes('小学语文100题.md'), '本地资料出处已渲染');
ok(!!badge && badge.textContent.includes('更上一层楼'), '本地资料原文已渲染（未加工）');
ok(!!badge && badge.textContent.includes('第二段原文'), '第二段命中同样渲染');
ok(!!badge && !!badge.querySelector('.qku-ref[open]'), '第一段默认展开，便于直接看');
ok(!!badge && !!badge.querySelector('.qku-dual-ans') && badge.querySelector('.qku-dual-ans').textContent.includes('B'), 'LLM 答案字母已渲染');
ok(!!badge && badge.textContent.includes('都不对'), '有「都不对」按钮');
ok(!!badge && badge.textContent.includes('采用 LLM 答案'), '有「采用 LLM 答案」按钮');

// 徽标必须具备防污染标记，否则下次 takeSnapshot 会把答案算进题干
ok(!!badge && badge.classList.contains('qku-answer-mark'), '带 qku-answer-mark 防题干污染');
ok(!!badge && badge.getAttribute('translate') === 'no', '带 translate=no，避免被页面翻译二次处理');

// 点「采用」→ 回调触发一次，且状态被替换（按钮消失，防重复点）
badge.querySelector('[data-act="llm"]').click();
ok(usedLlm === 1, '点「采用 LLM 答案」触发回调', 'usedLlm=' + usedLlm);
badgeApi.setDualState(badge, 'ok', '✅ 已采用 LLM 答案');
ok(!badge.querySelector('[data-act="llm"]'), '采用后按钮被替换（不能重复点）');
ok(badge.classList.contains('qku-ok'), '采用后进入 qku-ok 状态');

// 第二题点「都不对」
const q2 = snap.questions[1] || snap.questions[0];
const opened2 = badgeApi.renderDual(doc, q2, { refs: [], llm: { label: 'A', answer: 'A' } }, {
  useLlm: () => {}, reject: () => { rejected++; }
});
ok(opened2 === true, '第二题卡片渲染成功');
const badge2 = doc.querySelectorAll('.qku-dual-badge')[1] || badge;
ok(badge2.textContent.includes('未命中'), '无命中资料时给出明确提示');
badge2.querySelector('[data-act="wrong"]').click();
ok(rejected === 1, '点「都不对」触发回调', 'rejected=' + rejected);

// ===== 推理失败态：LLM 挂了也必须出卡片（这时资料原文才是唯一线索）=====
const q3 = snap.questions[2] || snap.questions[0];
const opened3 = badgeApi.renderDual(doc, q3, {
  refs: [{ docName: '语文资料.md', section: '三、词语', text: '本地原文：迫不及待的及是「等到」的意思', truncated: false }],
  llm: {},
  error: '所有服务商推理失败'
}, { reject: () => {} });
ok(opened3 === true, 'LLM 推理失败时照样渲染卡片', 'opened=' + opened3);
// 按题目锚点定位卡片（不能取 querySelectorAll()[0]——那是第 1 题的卡片）
const root3 = doc.querySelector('[data-qku-q="' + q3.index + '"]');
const badge3 = (root3 && root3.nextElementSibling && root3.nextElementSibling.classList.contains('qku-dual-badge'))
  ? root3.nextElementSibling : null;
ok(!!badge3, '卡片插在第 ' + (q3.index + 1) + ' 题容器之后');
ok(!!badge3 && badge3.textContent.includes('所有服务商推理失败'), '失败原因显示在卡片里', badge3 ? badge3.textContent.slice(0, 80) : 'null');
ok(!!badge3 && badge3.textContent.includes('本地原文：迫不及待'), '失败时仍然展示本地资料原文');
ok(!!badge3 && !!badge3.querySelector('.qku-dual-err'), '失败态使用 .qku-dual-err 样式块');
ok(!!badge3 && !badge3.querySelector('[data-act="llm"]'), '失败时不给「采用 LLM 答案」按钮（无答案可采）');
ok(!!badge3 && !!badge3.querySelector('[data-act="wrong"]'), '失败时保留「标记为需手填」按钮');

// 参考资料整体关闭时，文案不能说成"未命中"（那是两回事，会误导排查方向）
const q4 = snap.questions[3] || snap.questions[0];
badgeApi.renderDual(doc, q4, { refs: [], refsOff: true, llm: { label: 'C', answer: 'C' } }, {});
const root4 = doc.querySelector('[data-qku-q="' + q4.index + '"]');
const badge4 = (root4 && root4.nextElementSibling && root4.nextElementSibling.classList.contains('qku-dual-badge'))
  ? root4.nextElementSibling : null;
ok(!!badge4 && badge4.textContent.includes('参考资料未启用'), '资料功能关闭时提示「未启用」而非「未命中」',
  badge4 ? badge4.textContent.slice(0, 80) : 'null');

// 第三种状态：本次压根没检索（如无可用服务商，askAll 在检索前就抛了）
// refs=[].length 为假 → 但必须说「未检索」，不能说「未命中」
const q5 = snap.questions[4] || snap.questions[0];
badgeApi.renderDual(doc, q5, { refs: null, llm: { label: 'D', answer: 'D' } }, {});
const root5 = doc.querySelector('[data-qku-q="' + q5.index + '"]');
const badge5 = (root5 && root5.nextElementSibling && root5.nextElementSibling.classList.contains('qku-dual-badge'))
  ? root5.nextElementSibling : null;
ok(!!badge5 && badge5.textContent.includes('本次未检索资料'), '没检索过时提示「未检索」而非「未命中」',
  badge5 ? badge5.textContent.slice(0, 80) : 'null');
ok(!!badge5 && !badge5.textContent.includes('未命中'), '「未检索」场景下不出现「未命中」字样（避免误导）');

// 关掉 dualMode 应当整体失效（避免开关形同虚设）
ok(badgeApi.configure({ inlineBadge: false, dualMode: false }) === false, '关闭 dualMode 后徽标载体停用');

console.log('\n----- ' + pass + ' 通过 / ' + fail + ' 失败 -----');
process.exit(fail ? 1 : 0);
