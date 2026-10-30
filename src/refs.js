/**
 * QuizKing — refs.js
 * 本地 Markdown 参考资料：切块 / 分词 / BM25 检索 / prompt 注入。
 *
 * 设计约束：
 * - 纯函数、零浏览器依赖 —— 可在 node 里直接单测（tests/refs.test.mjs）。
 * - 不调用 embedding API：中文用「字符二元组」，英文数字用词，BM25 打分。
 *   零费用、零延迟、离线可用；对"按资料答题"这个场景召回足够。
 * - 检索不到就返回空数组，由调用方决定是否退化为通用作答（绝不硬塞无关资料）。
 */

// ===== 分词 =====
// 中文连续段 → 字符二元组（"计算机网络" → 计算/算机/机网/网络）
// 英文/数字 → 小写词
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const TOKEN_RE = /[\u3400-\u4dbf\u4e00-\u9fff]+|[A-Za-z][A-Za-z0-9_'’-]*|\d+(?:\.\d+)?/g;

// 极轻量停用二元组：只去掉高频虚词组合，避免短文档里 idf 被拉偏
const STOP = new Set([
  '的是', '了的', '一个', '我们', '你们', '他们', '这个', '那个', '可以', '以及',
  '所以', '因为', '但是', '而且', '如果', '就是', '不是', '没有', '什么', '怎么', '这些',
  '那些', '进行', '对于', '关于', '通过', '根据', '或者', '还是', '已经', '以上', '如下'
]);

export function tokenize(input) {
  const s = String(input || '').toLowerCase();
  const out = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(s))) {
    const w = m[0];
    if (CJK_RE.test(w)) {
      if (w.length === 1) {
        out.push(w);
      } else {
        for (let i = 0; i < w.length - 1; i++) {
          const bg = w.slice(i, i + 2);
          if (!STOP.has(bg)) out.push(bg);
        }
      }
    } else {
      out.push(w);
    }
  }
  return out;
}

// ===== 切块 =====
// 以 markdown 标题 + 段落为界，块长控制在 [minLen, maxLen]，
// 超长行按句末标点硬切（避免一整篇笔记变成不可检索的超大块）。
function hardCut(s, limit) {
  const win = s.slice(0, limit);
  const idx = Math.max(
    win.lastIndexOf('。'), win.lastIndexOf('！'), win.lastIndexOf('？'),
    win.lastIndexOf('；'), win.lastIndexOf('\n'), win.lastIndexOf(' ')
  );
  return idx > limit * 0.5 ? idx + 1 : limit;
}

export function chunkMarkdown(text, opts = {}) {
  const maxLen = Math.max(120, opts.maxLen || 600);
  const minLen = opts.minLen || 8;
  const raw = String(text || '').replace(/\r\n?/g, '\n');
  if (!raw.trim()) return [];

  const chunks = [];
  let section = '';
  let buf = [];
  let bufLen = 0;
  let seq = 0;

  const flush = () => {
    if (!buf.length) return;
    const body = buf.join('\n').trim();
    buf = [];
    bufLen = 0;
    if (body.length < minLen) return;
    chunks.push({ id: 'c' + (seq++), section, text: body, chars: body.length });
  };

  for (const line of String(raw).split('\n')) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      section = h[2].trim();
      buf.push(line);
      bufLen += line.length;
      continue;
    }
    if (!line.trim()) {
      // 段落边界：已经攒够大半就切，否则留在一个块里保持上下文
      if (bufLen > maxLen * 0.6) flush();
      else if (bufLen) buf.push('');
      continue;
    }
    let rest = line;
    while (rest.length > maxLen) {
      const cut = hardCut(rest, maxLen);
      buf.push(rest.slice(0, cut));
      bufLen += cut;
      flush();
      rest = rest.slice(cut);
    }
    if (rest) { buf.push(rest); bufLen += rest.length; }
    if (bufLen >= maxLen) flush();
  }
  flush();
  return chunks;
}

// ===== 索引（BM25）=====
export function buildIndex(chunks) {
  const docs = [];
  const df = new Map();
  for (const c of chunks) {
    const toks = tokenize((c.section ? c.section + ' ' : '') + c.text);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    docs.push({ chunk: c, tf, len: toks.length });
  }
  let total = 0;
  for (const d of docs) total += d.len;
  return { docs, df, N: docs.length, avgLen: docs.length ? total / docs.length : 0 };
}

/**
 * 检索最相关的资料块。
 * @param {object} index buildIndex() 的返回值
 * @param {string} query 题干（建议把选项文本一起传进来，提升召回）
 * @param {object} opts { topK, maxChars, minHits, relThreshold }
 * @returns {Array<{chunk, score, distinct}>} 按相关度降序
 */
export function search(index, query, opts = {}) {
  const topK = Math.max(1, opts.topK || 4);
  const maxChars = Math.max(200, opts.maxChars || 2400);
  const k1 = 1.2, b = 0.75;

  if (!index || !index.docs || !index.docs.length) return [];
  const qToks = tokenize(query);
  if (!qToks.length) return [];

  const qSet = new Set(qToks);
  const N = index.N;
  const avgLen = index.avgLen || 1;
  // 至少命中 2 个不同 token（查询本身很短时放宽到 1），挡住单字巧合
  const minHits = Math.min(opts.minHits != null ? opts.minHits : 2, qSet.size);

  const scored = [];
  for (const d of index.docs) {
    let score = 0;
    let distinct = 0;
    for (const t of qSet) {
      const tf = d.tf.get(t);
      if (!tf) continue;
      distinct++;
      const dfv = index.df.get(t) || 0;
      const idf = Math.log(1 + (N - dfv + 0.5) / (dfv + 0.5));
      const denom = tf + k1 * (1 - b + b * (d.len / avgLen));
      score += (idf * (tf * (k1 + 1))) / denom;
    }
    if (distinct >= minHits && score > 0) {
      scored.push({ chunk: d.chunk, docName: d.chunk.docName, docId: d.chunk.docId, score, distinct });
    }
  }
  if (!scored.length) return [];

  scored.sort((x, y) => y.score - x.score);

  // 相对阈值：低于最高分 35% 的块视为不相关，避免把无关段落塞给模型
  const rel = opts.relThreshold != null ? opts.relThreshold : 0.35;
  const floor = scored[0].score * rel;

  const picked = [];
  let used = 0;
  for (const s of scored) {
    if (picked.length >= topK) break;
    if (s.score < floor) break;
    if (picked.length && used + s.chunk.chars > maxChars) continue;
    picked.push(s);
    used += s.chunk.chars;
    if (used >= maxChars) break;
  }
  return picked;
}

// ===== 注入 prompt =====
function requirements(mode) {
  if (mode === 'strict') {
    return '【作答要求】资料能确定答案时以资料为准，并在 reasoning 中注明引用的资料编号；资料未涉及该题时，answer 必须返回"资料未涉及"，不要凭记忆作答。';
  }
  return '【作答要求】资料能确定答案时以资料为准，并在 reasoning 中注明引用的资料编号；资料未涉及该题时，可依据通用知识作答，但需在 reasoning 中说明"资料未涉及"。';
}

export function buildRefPrompt(hits, mode = 'prefer') {
  if (!hits || !hits.length) return '';
  const lines = ['【参考资料】（用户提供的本地文档，与本题高度相关，请优先采信）'];
  hits.forEach((h, i) => {
    const name = h.docName || (h.chunk && h.chunk.docName) || '未命名文档';
    const sec = (h.chunk && h.chunk.section) ? ' · ' + h.chunk.section : '';
    lines.push('');
    lines.push('<资料' + (i + 1) + '｜' + name + sec + '>');
    lines.push(h.chunk.text);
    lines.push('</资料' + (i + 1) + '>');
  });
  lines.push('');
  lines.push(requirements(mode));
  return lines.join('\n');
}

// 资料总量很小（不超过注入上限）时直接全文塞入：比分段检索更稳，不会漏召回。
export function buildFullRefPrompt(fullText, mode = 'prefer') {
  const t = String(fullText || '').trim();
  if (!t) return '';
  return '【参考资料】（用户提供的本地文档，已全文提供，请优先采信）\n\n' + t + '\n\n' + requirements(mode);
}

/**
 * 把检索结果裁成给界面展示的「本地资料原文」。
 * 刻意不做任何加工：不抽答案、不改写、不总结——原样呈现，用户自己对照判断。
 * 只做两件必要的事：截断长度（防消息/DOM 过大）、带上出处（文件名 + 章节）。
 */
export function toSnippets(hits, opts = {}) {
  const maxItems = Math.max(1, opts.maxItems || 2);
  const maxChars = Math.max(80, opts.maxChars || 400);
  return (hits || []).slice(0, maxItems).map(h => {
    const raw = String((h.chunk && h.chunk.text) || '');
    const cut = raw.length > maxChars;
    return {
      docName: h.docName || (h.chunk && h.chunk.docName) || '未命名文档',
      section: (h.chunk && h.chunk.section) || '',
      text: cut ? raw.slice(0, maxChars) + '…' : raw,
      truncated: cut,
      score: Math.round((h.score || 0) * 100) / 100
    };
  });
}

// 便于参考：给定原始文档数组 → 建索引（background 与测试共用同一路径）
// docs: [{ id, name, text }]
export function indexDocuments(docs) {
  const chunks = [];
  for (const d of docs || []) {
    const name = d.name || '未命名文档';
    for (const c of chunkMarkdown(d.text || '')) {
      chunks.push({ ...c, docId: d.id || name, docName: name });
    }
  }
  return { index: buildIndex(chunks), chunkCount: chunks.length };
}
