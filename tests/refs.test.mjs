// 参考资料检索单测：验证「按资料答题」的关键能力——能不能找到对的那一段。
// 运行：node tests/refs.test.mjs
import assert from 'node:assert/strict';
import { tokenize, chunkMarkdown, indexDocuments, search, buildRefPrompt, buildFullRefPrompt } from '../src/refs.js';

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { failures.push({ name, e }); console.log('  ✗ ' + name + ' — ' + e.message); }
}

const NET_MD = `# 计算机网络复习

## 第 1 章 概述
计算机网络是把分布在不同地理位置的多台计算机通过通信线路连接起来，实现资源共享的系统。
按覆盖范围可分为局域网、城域网和广域网。

## 第 2 章 TCP 三次握手
TCP 建立连接需要三次握手：客户端发送 SYN 报文，服务端回复 SYN+ACK，客户端再发送 ACK。
三次握手的目的是同步双方的序列号并确认收发能力正常。
断开连接需要四次挥手。

## 第 3 章 HTTP 状态码
200 表示请求成功，301 表示永久重定向，404 表示资源不存在，500 表示服务器内部错误。
302 是临时重定向。

## 第 4 章 子网划分
子网掩码用于区分网络号和主机号。C 类地址默认掩码是 255.255.255.0。
`;

const LEGAL_MD = `# 劳动合同法要点

## 试用期
劳动合同期限三个月以上不满一年的，试用期不得超过一个月。
一年以上不满三年的，试用期不得超过二个月。
三年以上固定期限和无固定期限的劳动合同，试用期不得超过六个月。

## 经济补偿
经济补偿按劳动者在本单位工作的年限，每满一年支付一个月工资的标准向劳动者支付。
`;

function buildAll() {
  return indexDocuments([
    { id: 'd1', name: '计算机网络复习.md', text: NET_MD },
    { id: 'd2', name: '劳动合同法要点.md', text: LEGAL_MD }
  ]);
}

console.log('\n[1] 分词');
check('中文按二元组切分', () => {
  const t = tokenize('三次握手');
  assert.deepEqual(t, ['三次', '次握', '握手']);
});
check('英文与数字保留整词并小写', () => {
  const t = tokenize('HTTP 200 OK');
  assert.ok(t.includes('http'), '应包含 http');
  assert.ok(t.includes('200'), '应包含 200');
  assert.ok(t.includes('ok'), '应包含 ok');
});
check('中英混排都能切出', () => {
  const t = tokenize('TCP三次握手');
  assert.ok(t.includes('tcp'));
  assert.ok(t.includes('握手'));
});

console.log('\n[2] 切块');
check('按标题切块且带 section 名', () => {
  const cs = chunkMarkdown(NET_MD);
  assert.ok(cs.length >= 4, '至少 4 块，实际 ' + cs.length);
  const secs = cs.map(c => c.section);
  assert.ok(secs.some(s => s.includes('三次握手')), '应有三次握手小节');
});
check('超长单行被切成多块', () => {
  const long = '这是一个很长的段落。'.repeat(400);
  const cs = chunkMarkdown(long, { maxLen: 300 });
  assert.ok(cs.length > 3, '应切成多块，实际 ' + cs.length);
  assert.ok(cs.every(c => c.chars <= 320), '块长应受控');
});
check('空文档返回空数组', () => {
  assert.deepEqual(chunkMarkdown(''), []);
  assert.deepEqual(chunkMarkdown('   \n\n  '), []);
});

console.log('\n[3] 检索命中');
const { index } = buildAll();

check('TCP 题目命中三次握手那一节', () => {
  const hits = search(index, 'TCP 建立连接为什么需要三次握手？', { topK: 3 });
  assert.ok(hits.length > 0, '应有命中');
  assert.ok(hits[0].chunk.section.includes('三次握手'),
    '首条应为三次握手，实际：' + hits[0].chunk.section);
});
check('HTTP 404 题目命中状态码那一节，不串到 TCP', () => {
  const hits = search(index, 'HTTP 404 状态码表示什么？', { topK: 3 });
  assert.ok(hits.length > 0);
  assert.ok(hits[0].chunk.section.includes('HTTP'), '应为 HTTP 小节，实际：' + hits[0].chunk.section);
  assert.ok(!hits[0].chunk.section.includes('三次握手'), '不应串到 TCP');
});
check('跨文档：试用期题目命中劳动法而非网络', () => {
  const hits = search(index, '三年以上劳动合同的试用期最长多久？', { topK: 3 });
  assert.ok(hits.length > 0);
  assert.ok(hits[0].docName === '劳动合同法要点.md', '应命中劳动法，实际：' + hits[0].docName);
});
check('选项文本一起参与检索能提升召回（C 类地址掩码）', () => {
  const q = 'C 类地址的默认子网掩码是多少？ A. 255.0.0.0 B. 255.255.0.0 C. 255.255.255.0 D. 255.255.255.255';
  const hits = search(index, q, { topK: 2 });
  assert.ok(hits.length > 0);
  assert.ok(hits[0].chunk.section.includes('子网划分'), '应为子网划分，实际：' + hits[0].chunk.section);
});
check('完全无关的问题返回空（不硬塞资料）', () => {
  const hits = search(index, '今天晚饭吃什么比较好呢', { topK: 3 });
  assert.equal(hits.length, 0, '无关问题不应命中，实际命中 ' + hits.length);
});
check('空查询返回空', () => {
  assert.deepEqual(search(index, '', {}), []);
  assert.deepEqual(search({ docs: [], df: new Map(), N: 0, avgLen: 0 }, 'TCP', {}), []);
});
check('maxChars 限制总注入长度', () => {
  const hits = search(index, '计算机网络 TCP 握手 HTTP 状态码 子网掩码', { topK: 6, maxChars: 400 });
  const used = hits.reduce((n, h) => n + h.chunk.chars, 0);
  assert.ok(used <= 400 + 200, '总长度应受控，实际 ' + used);
});

console.log('\n[4] prompt 注入');
check('注入文本带资料名、小节名与内容', () => {
  const hits = search(index, 'TCP 三次握手', { topK: 1 });
  const text = buildRefPrompt(hits, 'prefer');
  assert.ok(text.includes('【参考资料】'));
  assert.ok(text.includes('计算机网络复习.md'));
  assert.ok(text.includes('三次握手'));
  assert.ok(text.includes('【作答要求】'));
});
check('strict 模式要求「资料未涉及」就拒答', () => {
  const hits = search(index, 'TCP 三次握手', { topK: 1 });
  const text = buildRefPrompt(hits, 'strict');
  assert.ok(text.includes('资料未涉及'));
  assert.ok(text.includes('不要凭记忆作答'));
});
check('空 hits 返回空字符串（不注入空壳）', () => {
  assert.equal(buildRefPrompt([], 'prefer'), '');
});
check('小资料全量注入：带全文标识与作答要求', () => {
  const text = buildFullRefPrompt('【计算机网络复习.md】\nTCP 建立连接需要三次握手。', 'prefer');
  assert.ok(text.includes('已全文提供'), '应标注全文');
  assert.ok(text.includes('TCP 建立连接需要三次握手'), '应含原文');
  assert.ok(text.includes('【作答要求】'), '应含作答要求');
});
check('空全文不注入', () => {
  assert.equal(buildFullRefPrompt('', 'prefer'), '');
  assert.equal(buildFullRefPrompt('   ', 'strict'), '');
});

console.log('\n[5] 规模与性能');
check('10 万字文档索引与检索在 2 秒内', () => {
  const big = ('# 章节\n\n' + '这是一段用于压测的中文资料，包含计算机网络与 TCP 握手等内容。'.repeat(500) + '\n\n').repeat(4);
  const t0 = Date.now();
  const { index: idx } = indexDocuments([{ id: 'big', name: 'big.md', text: big }]);
  const hits = search(idx, 'TCP 握手过程是怎样的', { topK: 4 });
  const ms = Date.now() - t0;
  assert.ok(hits.length > 0 || big.length < 1000, '大文档应能检索');
  assert.ok(ms < 2000, '耗时 ' + ms + 'ms 超过 2s');
  console.log('    （' + Math.round(big.length / 1000) + 'k 字，索引+检索 ' + ms + 'ms）');
});

console.log('\n' + '─'.repeat(50));
console.log(`通过 ${pass} 项，失败 ${failures.length} 项`);
if (failures.length) {
  failures.forEach(f => console.log('\n✗ ' + f.name + '\n' + f.e.stack));
  process.exit(1);
}
