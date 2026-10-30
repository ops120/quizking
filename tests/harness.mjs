// 本地测试桩：把扩展的 quiz-snapshot.js 源码 eval 进 jsdom 的 window 上下文运行，
// 完全不修改扩展代码本身。jsdom 不计算布局，getBoundingClientRect 全 0，
// 会让 visible() 全部返回 false；这里打桩假定 HTML 内元素都可见（测试只验证结构识别逻辑）。
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP_SRC = fs.readFileSync(path.resolve(__dirname, '../src/quiz-snapshot.js'), 'utf8');

export function runFixture(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.com/quiz',
  });
  const { window } = dom;

  // 让"可见性"判定通过（测试场景假定元素均可见）
  window.Element.prototype.getBoundingClientRect = function () {
    return { width: 200, height: 24, top: 0, left: 0, right: 200, bottom: 24, x: 0, y: 0 };
  };
  // CSS.escape 兜底（部分 jsdom 版本缺失）
  if (!window.CSS) window.CSS = {};
  if (typeof window.CSS.escape !== 'function') {
    window.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (m) => '\\' + m);
  }

  // 在 window 上下文执行扩展源码（源码里 window.QuizSnapshot = ... 会挂到 jsdom window 上）
  window.eval(SNAP_SRC);
  const snap = window.QuizSnapshot.takeSnapshot(window.document);
  return snap;
}
