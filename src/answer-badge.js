/**
 * QuizKing Ultimate — answer-badge.js
 * 行内答案徽标：把 LLM 答案插到对应题目容器**后面**（兄弟节点），题干/选项一字不动。
 *
 * 设计借鉴自沉浸式翻译双语渲染（见 .doc/ 借鉴分析），按 quizking 场景裁剪：
 *   1. 兄弟节点插入：insertBefore(徽标, root.nextSibling)，不碰题目自身 DOM，
 *      站点 JS 遍历题目子节点的行为不受影响（比 appendChild 进容器内更安全）。
 *   2. 固定高度占位：先插占位徽标，答案返回后只换 innerHTML——盒子几何不变，
 *      选项零位移。自动点击的正确性依赖这一点（答案后插会把选项顶下去导致点错）。
 *   3. 三层免处理标记：qku-answer-mark class + translate="no" + lang，
 *      ① 下次 takeSnapshot 的 TreeWalker 会跳过它（防题干自污染）；
 *      ② 用户开着浏览器自带翻译时答案不被二次翻译。
 *   4. 查重：插入前看后一个"有意义的兄弟"（跳过空白文本节点）是否已是徽标，
 *      是则复用不新建——SPA 重渲染 / 重复触发时不叠徽标。
 *   5. 显隐：只改 documentElement 的 qku-answer-state 属性 + CSS，不删 DOM。
 *
 * 依赖：quiz-snapshot.js 的 data-qku-q 锚点（先于本文件加载，见 manifest.json）。
 * 开关：cfg.inlineBadge（选项页，默认关）。iframe：all_frames 注入，
 *       徽标创建在题目所在文档内；显隐对同源 iframe 可见，跨域 iframe 受浏览器限制。
 */

window.QuizBadge = (() => {
  const MARK = 'qku-answer-mark';
  const BADGE = 'qku-answer-badge';
  let enabled = false;

  function log(...a) { try { console.log('[badge]', ...a); } catch(e) {} }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function qs() { return window.QuizSnapshot || {}; }

  // 配置：只有选项页打开 inlineBadge 才渲染
  function configure(cfg) {
    enabled = !!(cfg && cfg.inlineBadge);
    if (!enabled) clearAllAccessible();
    log('configure: inlineBadge=' + enabled);
    return enabled;
  }

  function isEnabled() { return enabled; }

  // 后一个"有意义的"元素兄弟：跳过空白文本节点（页面里到处是 \n 缩进）。
  // 遇到有意义的文本节点返回 null（那不是徽标，是页面自己的内容）。
  function nextMeaningfulElement(el) {
    let n = el ? el.nextSibling : null;
    while (n) {
      if (n.nodeType === Node.TEXT_NODE) {
        if ((n.textContent || '').trim()) return null;
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        return n;
      }
      n = n.nextSibling;
    }
    return null;
  }

  function isBadge(el) {
    return !!(el && el.classList && el.classList.contains(MARK));
  }

  // 插入或复用徽标，返回徽标元素；root 不可插（body/文档元素/无父节点）时返回 null
  function ensure(root) {
    if (!root || !root.parentNode) return null;
    const doc = root.ownerDocument;
    if (root === doc.body || root === doc.documentElement) return null; // 兜底容器没有"题目"语义
    const next = nextMeaningfulElement(root);
    if (isBadge(next)) return next; // 查重：已存在则复用，不叠 second wrapper
    const badge = doc.createElement('font');
    badge.className = BADGE + ' ' + MARK + ' notranslate';
    badge.setAttribute('translate', 'no');
    badge.setAttribute('lang', 'zh-CN');
    badge.classList.add('qku-pending');
    badge.innerHTML = '<span class="qku-badge-spinner"></span><span class="qku-badge-pending-text">推理中…</span>';
    root.parentNode.insertBefore(badge, root.nextSibling);
    return badge;
  }

  function getRoot(doc, index) {
    const find = qs().findQuestionRoot;
    if (!find) return null;
    try { return find(doc, index); } catch(e) { return null; }
  }

  // 推理前：给每道题插占位徽标（固定高度，答案回来后原位替换）
  function renderPending(doc, questions) {
    if (!enabled || !questions) return 0;
    let n = 0;
    questions.forEach(q => {
      const root = getRoot(doc, q.index);
      if (root && ensure(root)) n++;
    });
    log('renderPending:', n + '/' + questions.length);
    return n;
  }

  function letters(res) {
    if (res.isMulti) {
      return (res.optionIndices || []).map(i => String.fromCharCode(65 + i)).join(',');
    }
    return String.fromCharCode(65 + (res.optionIndex || 0));
  }

  // 推理成功：原位替换占位内容（盒子不变，选项不位移）
  // clicked：executeAnswer 的返回值——是否真的点上了，没点上就标"未勾选"
  function fill(doc, question, res, clicked) {
    if (!enabled) return false;
    const root = getRoot(doc, question.index);
    if (!root) return false;
    const badge = ensure(root);
    if (!badge) return false;
    badge.classList.remove('qku-pending', 'qku-err');
    const chipCls = clicked ? 'qku-badge-chip' : 'qku-badge-chip qku-badge-chip-warn';
    const chipText = clicked ? '已勾选' : '未勾选';
    badge.innerHTML =
      '<span class="qku-badge-head">' +
        '<span class="qku-badge-ans">答案 ' + escapeHtml(letters(res)) + '</span>' +
        '<span class="' + chipCls + '">' + chipText + '</span>' +
      '</span>' +
      (res.answer ? '<span class="qku-badge-text">' + escapeHtml(String(res.answer).slice(0, 120)) + '</span>' : '') +
      (res.reasoning ? '<details class="qku-badge-reason"><summary>解析</summary><span class="qku-badge-reason-text">' + escapeHtml(res.reasoning) + '</span></details>' : '');
    return true;
  }

  // 推理失败：占位盒原位置换成错误态（同样不引入位移）
  function fillError(doc, question, error) {
    if (!enabled) return false;
    const root = getRoot(doc, question.index);
    if (!root) return false;
    const badge = ensure(root);
    if (!badge) return false;
    badge.classList.remove('qku-pending');
    badge.classList.add('qku-err');
    badge.innerHTML = '<span class="qku-badge-err-text">推理失败：' + escapeHtml(error || '未知错误') + '</span>';
    return true;
  }

  // 清掉本扩展注入的所有徽标（重跑自动答题前调用，避免新旧答案并存）
  function clear(doc) {
    const d = doc || document;
    try {
      d.querySelectorAll('.' + MARK).forEach(el => el.remove());
    } catch(e) {}
  }

  function clearAllAccessible() {
    clear(document);
    accessibleDocs().forEach(clear);
  }

  // 顶层文档 + 所有同源 iframe 文档（跨域的 contentDocument 抛错，跳过）
  function accessibleDocs() {
    const list = [];
    try {
      document.querySelectorAll('iframe').forEach(f => {
        try {
          const d = f.contentDocument;
          if (d && d.defaultView !== window) list.push(d);
        } catch(e) {}
      });
    } catch(e) {}
    return list;
  }

  // 显隐：属性 + CSS，DOM 保留（切"隐藏"不清内容，切回来零成本）
  function setVisible(on) {
    const val = on ? 'on' : 'off';
    const docs = [document].concat(accessibleDocs());
    docs.forEach(d => {
      try { d.documentElement.setAttribute('qku-answer-state', val); } catch(e) {}
    });
    log('setVisible:', val, '| docs=' + docs.length);
    return !!on;
  }

  function isVisible(doc) {
    const d = doc || document;
    try { return d.documentElement.getAttribute('qku-answer-state') !== 'off'; } catch(e) { return true; }
  }

  // 在顶层 frame 调用（popup/FAB 入口）：切换显隐并返回新状态
  function toggleVisible() {
    return setVisible(!isVisible());
  }

  return { configure, isEnabled, renderPending, fill, fillError, clear, clearAllAccessible, setVisible, isVisible, toggleVisible };
})();
