// 通过 CDP 连接已登录的 Chrome，在 jutiku 真实页面上直接执行 quiz-snapshot 的 takeSnapshot，
// 输出真实 DOM 下的题目识别结果（比 fixture 推测准得多）。
// 前置：Chrome 必须以 --remote-debugging-port=9222 启动。
// 用法：node tests/analyze-jutiku.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const TARGET = process.env.JUTIKU_URL || 'https://www.jutiku.cn/test?pid=5991';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 收集所有上下文里的所有页面
function allPages(browser) {
  const out = [];
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) out.push(p);
  return out;
}

const browser = await chromium.connectOverCDP(CDP);
console.log('[ok] connected to Chrome via CDP');

// 找已打开的 jutiku 试卷页（必须精确匹配目标试卷）；没有就导航过去
let page = allPages(browser).find((p) => (p.url() || '').split('#')[0] === TARGET);
if (!page) {
  const base = allPages(browser).find((p) => (p.url() || '').includes('jutiku')) || allPages(browser)[0];
  if (!base) { console.error('[x] no page found in browser'); process.exit(1); }
  console.log('[~] navigating', base.url().slice(0, 60), '->', TARGET);
  try {
    await base.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.log('[!] goto interrupted (' + e.message.split('\n')[0] + '), rescanning tabs...');
  }
  // 试卷页可能是新开的标签页：轮询重扫 10 次
  for (let i = 0; i < 10 && !page; i++) {
    await sleep(1500);
    page = allPages(browser).find((p) => (p.url() || '').includes('/test?'));
  }
}
if (!page) {
  console.error('[x] test page not found. open tabs:');
  for (const p of allPages(browser)) console.error('   -', (p.url() || '').slice(0, 90));
  process.exit(1);
}
console.log('[ok] page:', page.url());

// 等页面稳定（可能还在继续跳转）
for (let i = 0; i < 5; i++) {
  try { await page.waitForLoadState('domcontentloaded', { timeout: 5000 }); break; }
  catch { await sleep(1500); page = allPages(browser).find((p) => (p.url() || '').split('#')[0] === TARGET) || page; }
}
await sleep(2500);

// 把扩展的 quiz-snapshot 源码注入页面并执行
const snapSrc = fs.readFileSync(path.resolve(__dirname, '../src/quiz-snapshot.js'), 'utf8');
try {
  await page.addScriptTag({ content: snapSrc });
} catch (e) {
  console.error('[x] inject failed:', e.message.split('\n')[0], '- page url:', page.url());
  process.exit(1);
}

const result = await page.evaluate(() => {
  const s = window.QuizSnapshot.takeSnapshot(document);
  return {
    href: location.href,
    total: s.totalQuestions,
    submit: s.submitButtons.map((b) => b.text),
    questions: s.questions.map((q) => ({
      type: q.type,
      stem: (q.stem || '').slice(0, 60),
      opts: q.options.map((o) => (o.text || '').slice(0, 20)),
    })),
  };
});
console.log(JSON.stringify(result, null, 2));

// 同时把真实 DOM 存成 fixture，本地测试以后就用它
try {
  const html = await page.content();
  const out = path.resolve(__dirname, 'fixtures/jutiku-real.html');
  fs.writeFileSync(out, html);
  console.log('[ok] real DOM saved ->', out, '(' + Math.round(html.length / 1024) + ' KB)');
} catch (e) {
  console.log('[!] DOM save failed:', e.message.split('\n')[0]);
}

// 不调用 browser.close()，避免误关用户正在用的 Chrome
process.exit(0);
