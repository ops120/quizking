// 「需人工处理」队列单测（src/manual-queue.js）。
// 这段逻辑原先写在 content.js 的闭包里完全测不到，出过"用户结束点选的题
// 永远进不了清单"的真 bug，所以抽成纯函数并在这里锁住语义。
// 用法：node tests/manual-queue.test.mjs
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/manual-queue.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
const { window } = dom;
window.eval(SRC);

const MQ = window.ManualQueue;
ok(!!MQ && typeof MQ.createQueue === 'function', '脚本加载并挂到 window.ManualQueue');

// ===== 基础语义 =====
let q = MQ.createQueue();
ok(q.isEmpty() === true && q.size === 0, '新队列为空');

ok(q.add(3, '推理失败') === true, 'add 新题返回 true（条数变了）');
ok(q.size === 1, '加入后 size=1');

// 同一题重复加入：不能出现两条（否则用户会看到重复题号）
ok(q.add(3, '都不对') === false, '同题重复 add 返回 false（只更新理由）');
ok(q.size === 1, '同题重复 add 后 size 仍为 1', 'size=' + q.size);
ok(q.list()[0].reason === '都不对', '理由被更新为最新一次', q.list()[0].reason);

q.add(7, '点击未生效');
q.add(1, '批量失败');
ok(q.size === 3, '三题入队 size=3');

// 渲染顺序按题号升序：用户从第 1 题往下处理更顺手
const idxs = q.list().map(x => x.index);
ok(idxs.join(',') === '1,3,7', 'list 按题号升序返回', idxs.join(','));

// list 必须返回副本，渲染方改不动内部状态
const snapshot = q.list();
snapshot[0].index = 999;
snapshot.push({ index: 100, reason: 'hack' });
ok(q.size === 3 && q.has(1) && !q.has(999), 'list 返回副本，外部修改不影响队列');

// ===== 移除 =====
ok(q.remove(3) === true, 'remove 已存在的题返回 true');
ok(q.size === 2 && !q.has(3), '移除后 size=2 且不再包含该题');
ok(q.remove(3) === false, 'remove 不存在的题返回 false（幂等，不报错）');

// ===== 脏数据防护 =====
ok(q.add(NaN, 'x') === false, 'add 非数字题号被拒（防脏数据污染清单）');
ok(q.add(undefined, 'x') === false, 'add undefined 题号被拒');
ok(q.size === 2, '被拒的 add 不改变队列', 'size=' + q.size);

// ===== 清空 =====
q.clear();
ok(q.isEmpty() === true && q.size === 0, 'clear 清空队列');
ok(q.list().length === 0, 'clear 后 list 为空数组');

// ===== 真实流程：对照模式下一题从"失败"到"已采用" =====
q = MQ.createQueue();
q.add(5, '推理失败：所有服务商推理失败');   // 循环内，LLM 挂了
ok(q.size === 1, '场景① 推理失败进队列');
q.add(5, '两个答案都不对，需手动作答');     // 循环结束后用户点「都不对」
ok(q.size === 1, '场景② 之后点「都不对」，仍只有 1 条（关键：原来这里会漏）');
q.remove(5);                               // 用户改主意，点「采用 LLM 答案」且成功
ok(q.size === 0 && q.isEmpty(), '场景③ 采用成功后移出队列 → isEmpty（气泡据此收起）');

console.log('\n----- ' + pass + ' 通过 / ' + fail + ' 失败 -----');
process.exit(fail ? 1 : 0);
