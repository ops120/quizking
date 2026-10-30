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

  // 配置：选项页打开 inlineBadge，或打开「对照模式」（双答案必须依托徽标载体）时渲染
  function configure(cfg) {
    enabled = !!(cfg && (cfg.inlineBadge || cfg.dualMode));
    if (!enabled) clearAllAccessible();
    log('configure: inlineBadge=' + !!(cfg && cfg.inlineBadge) + ' dualMode=' + !!(cfg && cfg.dualMode) + ' enabled=' + enabled);
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

  // ===== 降级兜底（L2）：无视 inlineBadge 开关，在题旁强制显示答案 =====
  // 用于自动点击失败 / 推理失败时，把答案留下交人工确认，保证项目不因"点不动"而废掉。
  function forceFill(doc, question, res, clicked) {
    const root = getRoot(doc, question.index);
    if (!root) return false;
    const badge = ensure(root);
    if (!badge) return false;
    badge.classList.remove('qku-pending', 'qku-err');
    const chipCls = clicked ? 'qku-badge-chip' : 'qku-badge-chip qku-badge-chip-warn';
    const chipText = clicked ? '已勾选' : '待你确认';
    badge.innerHTML =
      '<span class="qku-badge-head">' +
        '<span class="qku-badge-ans">答案 ' + escapeHtml(letters(res)) + '</span>' +
        '<span class="' + chipCls + '">' + chipText + '</span>' +
      '</span>' +
      (res.answer ? '<span class="qku-badge-text">' + escapeHtml(String(res.answer).slice(0, 120)) + '</span>' : '') +
      (res.reasoning ? '<details class="qku-badge-reason"><summary>解析</summary><span class="qku-badge-reason-text">' + escapeHtml(res.reasoning) + '</span></details>' : '');
    return true;
  }

  function forceError(doc, question, error) {
    const root = getRoot(doc, question.index);
    if (!root) return false;
    const badge = ensure(root);
    if (!badge) return false;
    badge.classList.remove('qku-pending');
    badge.classList.add('qku-err');
    badge.innerHTML = '<span class="qku-badge-err-text">需手动处理：' + escapeHtml(error || '未知错误') + '</span>';
    return true;
  }

  // ===== 对照模式（dualMode）：本地资料原文 + LLM 答案并列，用户自己判断 =====
  // 定位：本地检索（BM25）能命中资料，但"命中的原文"和"模型的结论"可能不一致，
  // 谁对由用户定。所以这里只负责「如实并列 + 收集选择」，不替用户决定。
  // 两条铁律：
  //   1. 本地一侧原样输出命中段落（不抽答案、不总结），可逐字核查；
  //   2. 不自动填写任何选项——必须用户点「采用」才由 content.js 执行。
  function renderDual(doc, question, data, handlers) {
    const root = getRoot(doc, question.index);
    if (!root) return false;
    const badge = ensure(root);
    if (!badge) return false;

    const llm = (data && data.llm) || {};
    // refs 三种状态要分开说，否则排查方向会被带偏：
    //   null → 本次压根没检索（LLM 调用前就失败）
    //   []   → 检索了但没命中
    //   数组 → 命中原文
    const refsRaw = data ? data.refs : undefined;
    const refsSkipped = refsRaw === null;
    const refs = Array.isArray(refsRaw) ? refsRaw : [];
    const label = llm.label || '?';
    // 推理失败也要出卡片：模型没答案时，命中的资料原文往往才是唯一线索。
    // 此时 LLM 区块只报错、不给「采用」按钮（没有可采用的答案）。
    const llmErr = String((data && data.error) || '').trim();

    let refsHtml;
    if (refs.length) {
      refsHtml = refs.map((r, i) => {
        const src = escapeHtml(r.docName || '未命名文档') + (r.section ? ' · ' + escapeHtml(r.section) : '');
        return '<details class="qku-ref"' + (i === 0 ? ' open' : '') + '>' +
          '<summary class="qku-ref-src">' + src + (r.truncated ? '（截断）' : '') + '</summary>' +
          '<div class="qku-ref-full">' + escapeHtml(String(r.text || '')) + '</div>' +
          '</details>';
      }).join('');
    } else if (data && data.refsOff) {
      // 「资料功能没开」和「资料里没有这题」是两回事，不能都写成"未命中"
      refsHtml = '<div class="qku-ref-none">参考资料未启用 —— 设置页「📚 参考资料」里打开后才有本地对照</div>';
    } else if (refsSkipped) {
      refsHtml = '<div class="qku-ref-none">本次未检索资料：模型调用前就失败了，没有本地对照</div>';
    } else {
      refsHtml = '<div class="qku-ref-none">本地资料未命中这道题 —— 左无对照，只能看模型了</div>';
    }

    badge.classList.remove('qku-pending', 'qku-err', 'qku-ok', 'qku-wrong');
    badge.classList.add('qku-dual-badge');
    badge.style.display = 'block';
    badge.innerHTML =
      '<div class="qku-dual">' +
        '<div class="qku-dual-head">' +
          '<span class="qku-dual-title">第 ' + (question.index + 1) + ' 题 · 两个答案，你来定</span>' +
          '<span class="qku-dual-state">待选择</span>' +
        '</div>' +
        '<div class="qku-dual-sec">' +
          '<div class="qku-dual-label">📚 本地资料原文' + (refs.length ? '（BM25 命中 ' + refs.length + ' 段）' : '') + '</div>' +
          refsHtml +
        '</div>' +
        '<div class="qku-dual-sec">' +
          '<div class="qku-dual-label">🤖 LLM 答案</div>' +
          (llmErr
            ? '<div class="qku-dual-err">未给出答案：' + escapeHtml(llmErr) + '</div>'
            : '<div class="qku-dual-ans">' + escapeHtml(String(label)) +
                (llm.answer && String(llm.answer).trim().toUpperCase() !== String(label).toUpperCase()
                  ? '<span class="qku-dual-ans-sub">' + escapeHtml(String(llm.answer).slice(0, 60)) + '</span>' : '') +
              '</div>' +
              (llm.reasoning ? '<details class="qku-badge-reason"><summary>解析</summary><span class="qku-badge-reason-text">' + escapeHtml(llm.reasoning) + '</span></details>' : '')) +
        '</div>' +
        '<div class="qku-dual-actions">' +
          (llmErr
            ? '<button type="button" class="qku-btn qku-btn-ghost" data-act="wrong">标记为需手填</button>'
            : '<button type="button" class="qku-btn qku-btn-primary" data-act="llm">采用 LLM 答案</button>' +
              '<button type="button" class="qku-btn qku-btn-ghost" data-act="wrong">都不对</button>') +
        '</div>' +
      '</div>';

    // preventDefault + stopPropagation：徽标紧跟在题目容器之后，按钮点击不能冒泡到
    // 站点的选项/label 上，否则"点按钮"会顺手把某个选项点掉。
    const bind = (sel, fn) => {
      const el = badge.querySelector(sel);
      if (!el) return;
      el.onclick = (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch(err) {}
        try { fn(badge); } catch(err) { log('dual action error', err); }
      };
    };
    bind('[data-act="llm"]', (b) => handlers && handlers.useLlm && handlers.useLlm(b));
    bind('[data-act="wrong"]', (b) => handlers && handlers.reject && handlers.reject(b));
    return true;
  }

  // 用户做出选择后更新卡片状态（按钮替换成结论，避免重复点）
  function setDualState(badge, state, text) {
    if (!badge) return false;
    badge.classList.remove('qku-pending', 'qku-err');
    badge.classList.toggle('qku-ok', state === 'ok');
    badge.classList.toggle('qku-wrong', state === 'wrong');
    const st = badge.querySelector('.qku-dual-state');
    if (st) st.textContent = state === 'wrong' ? '已标记' : '已采用';
    const acts = badge.querySelector('.qku-dual-actions');
    if (acts) acts.innerHTML = '<span class="qku-dual-done">' + escapeHtml(text || '') + '</span>';
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

  return { configure, isEnabled, renderPending, fill, fillError, forceFill, forceError, renderDual, setDualState, clear, clearAllAccessible, setVisible, isVisible, toggleVisible };
})();
