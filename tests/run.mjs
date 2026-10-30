// 运行所有 fixture 的题目识别测试。
// 用法：
//   node tests/run.mjs                    跑全部 fixture 并对照基线（有漂移则退出码 1）
//   node tests/run.mjs jutiku             只跑文件名含 "jutiku" 的 fixture
//   node tests/run.mjs --update           把当前识别结果写成新基线（识别逻辑有意变更后用）
//
// 为什么要有基线：本文件早期版本只打印不断言，识别从 61 题退化成 0 题
// npm test 也会"全绿"。基线 = 每个页面的题数 + 题型序列，题型串对结构变化极敏感。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFixture } from './harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(__dirname, 'fixtures');
const BASELINE_FILE = path.join(__dirname, 'baseline.json');

const argv = process.argv.slice(2);
const doUpdate = argv.includes('--update');
const only = argv.find(a => !a.startsWith('--')) || '';

const files = fs.readdirSync(FIX).filter((f) => f.endsWith('.html')).sort();

const sigOf = (snap) => snap.questions.map((q) => q.type).join(',');

const results = {};   // f -> { questions, types }（--update 时写入基线）
let bad = 0, missing = 0;

for (const f of files) {
  if (only && !f.includes(only)) continue;
  const file = path.join(FIX, f);
  let snap;
  try {
    snap = runFixture(file);
  } catch (e) {
    console.log(`\n=== ${f} ===\n  ❌ 运行出错: ${e.message}`);
    bad++;
    continue;
  }

  const sig = sigOf(snap);
  results[f] = { questions: snap.totalQuestions, types: sig };

  console.log(`\n=== ${f} ===`);
  console.log(`  识别到 ${snap.totalQuestions} 题，交卷按钮 ${snap.submitButtons.length} 个`);
  snap.questions.forEach((q, i) => {
    const stem = (q.stem || '').slice(0, 42);
    const opts = q.options
      .map((o) => `${String.fromCharCode(65 + o.index)}.${(o.text || '').slice(0, 14)}`)
      .join(' ');
    console.log(`  [${i}] ${q.type} | 选项${q.options.length} | ${stem}`);
    if (opts) console.log(`       ${opts}`);
  });

  const base = (doUpdate || !fs.existsSync(BASELINE_FILE)) ? null
    : JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))[f];
  if (doUpdate) {
    console.log('  ⏺ 已记入新基线');
  } else if (!base) {
    missing++;
    console.log('  ⚠ 无基线记录（新 fixture？跑 node tests/run.mjs --update 生成）');
  } else if (base.questions !== snap.totalQuestions || base.types !== sig) {
    bad++;
    console.log(`  ❌ 与基线不一致！基线 ${base.questions} 题 [${base.types}]`);
    console.log(`                实际  ${snap.totalQuestions} 题 [${sig}]`);
    console.log('                识别结果漂移 —— 若是有意改动，跑 node tests/run.mjs --update 刷新基线');
  } else {
    console.log('  ✅ 与基线一致');
  }
}

if (doUpdate) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(results, null, 2) + '\n');
  console.log(`\n----- 基线已更新：${Object.keys(results).length} 个页面（tests/baseline.json）-----`);
} else {
  const parts = [];
  if (bad) parts.push(`❌ ${bad} 个页面与基线不一致`);
  if (missing) parts.push(`${missing} 个页面缺基线`);
  if (!parts.length) {
    console.log(`\n----- ✅ ${files.length} 个页面全部与基线一致（共 ${files.reduce((n, f) => n + (results[f]?.questions || 0), 0)} 题）-----`);
  } else {
    console.log('\n----- ' + parts.join('，') + ' -----');
    process.exit(1);
  }
}
