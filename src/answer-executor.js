/**
 * QuizKing Ultimate — answer-executor.js
 * 作答执行器：点击选项 / 填写输入框 / 多选多次点击
 * 来源：interface-assistant 移植
 *
 * 注意：highlight.js 在本文件之前加载（见 manifest.json），因此 window.QuizHighlight 可用。
 * 这里仍做懒解析，避免未来调整加载顺序时静默失效。
 */

window.AnswerExecutor = (() => {
  function qh() { return window.QuizHighlight || {}; }
  function qs() { return window.QuizSnapshot || {}; }

  function log(...a) { try { console.log('[executor]', ...a); } catch(e) {} }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // 生成元素选择器：优先复用 quiz-snapshot 的实现，缺失时退化为 tag+id
  function buildSelector(el) {
    if (qs().buildSelector) return qs().buildSelector(el);
    if (el.id) return '#' + CSS.escape(el.id);
    return el.tagName.toLowerCase();
  }

  // doc：题目所在文档（iframe 内题目需传入其 contentDocument）
  function findEl(doc, selector) {
    const d = doc || document;
    try { return d.querySelector(selector); } catch(e) { log('querySelector 抛错:', selector, e.message); return null; }
  }

  // 验证选项是否真的被选中 —— 这是 P0 修复的核心：
  // 原生 click 对 React/Vue/自绘控件经常"调用了但状态没变"，不验证就会产生假成功。
  function verifySelected(selector, doc) {
    const d = doc || document;
    const el = findEl(d, selector);
    if (!el) return false;
    // 1) 原生表单控件
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked) return true;
    }
    // 2) ARIA 控件
    const ari = el.getAttribute && el.getAttribute('aria-checked');
    if (ari === 'true') return true;
    // 3) 真正状态在内部 input 上（点的是 label/容器）
    const inner = el.querySelector && el.querySelector('input[type=radio], input[type=checkbox]');
    if (inner && inner.checked) return true;
    // 4) 自绘控件：祖先出现选中态 class
    let p = el.parentElement;
    while (p && p !== d.body) {
      if (p.classList && (p.classList.contains('selected') || p.classList.contains('checked') ||
          p.classList.contains('active') || p.classList.contains('is-active') || p.classList.contains('is-checked'))) return true;
      p = p.parentElement;
    }
    return false;
  }

  // 完整事件序列（兼容受控组件），点击未生效时补发
  function dispatchClickSequence(el, doc) {
    const d = doc || document;
    try {
      const view = d.defaultView || window;
      const opts = { bubbles: true, cancelable: true, view };
      ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup'].forEach(type => {
        const Ctor = type.startsWith('pointer') ? view.PointerEvent : view.MouseEvent;
        el.dispatchEvent(new Ctor(type, opts));
      });
      return true;
    } catch(e) { log('事件序列点击失败:', e.message); return false; }
  }

  async function clickOption(selector, dryRun, doc) {
    if (dryRun) return true;
    const el = findEl(doc, selector);
    if (!el) { log('element not found:', selector, '| doc 是 iframe?', !!(doc && doc !== document)); return false; }
    log('click:', selector, '| tag=', el.tagName, '| disabled=', !!el.disabled);
    try {
      el.click();
      await sleep(60);
      if (verifySelected(selector, doc)) return true;
      // 原生 click 未改变选中态 → 补发事件序列（受控组件常见）
      log('原生 click 未生效，降级事件序列:', selector);
      dispatchClickSequence(el, doc);
      await sleep(60);
      if (verifySelected(selector, doc)) return true;
      log('点击后仍验证失败（可能需人工）:', selector);
      return false;
    } catch(e) {
      log('clickOption 异常，降级事件序列:', e.message);
      try {
        const e2el = findEl(doc, selector);
        if (e2el) { dispatchClickSequence(e2el, doc); await sleep(60); return verifySelected(selector, doc); }
      } catch(e2) { log('force click failed:', e2.message); }
      return false;
    }
  }

  // opts: { dryRun, doc }
  async function executeAnswer(question, answer, opts) {
    opts = opts || {};
    const dryRun = opts.dryRun;
    const doc = opts.doc || document;
    const type = question.type;
    const reason = answer.reasoning || answer.reason || '';

    switch (type) {
      case 'single_choice':
      case 'true_false': {
        const idx = answer.optionIndex;
        if (idx === undefined || idx === null || idx < 0) {
          qh().showPanel && qh().showPanel('⚠ 作答失败', '无法确定选项', '推理结果缺少选项索引');
          return false;
        }
        const opt = question.options[idx];
        if (!opt || !opt.selector) {
          qh().showPanel && qh().showPanel('⚠ 作答失败', '选项元素未找到', '页面结构可能已变化');
          return false;
        }

        qh().highlightElement && qh().highlightElement(opt.selector, doc);
        qh().moveCursor && qh().moveCursor(opt.selector, doc);
        qh().showPanel && qh().showPanel(dryRun ? '📖 讲解' : '🖱 选择', '[' + opt.text + ']', reason);

        if (!dryRun) {
          await sleep(300);
          return await clickOption(opt.selector, false, doc);
        }
        return true;
      }

      case 'multi_choice': {
        const indices = answer.optionIndices || [];
        if (indices.length === 0) return false;
        let allOk = true;
        for (const idx of indices) {
          const opt = question.options[idx];
          if (!opt || !opt.selector) { allOk = false; continue; }
          qh().highlightElement && qh().highlightElement(opt.selector, doc);
          qh().showPanel && qh().showPanel('☑ 多选', '[' + opt.text + ']', reason);
          if (!dryRun) { await sleep(200); const ok = await clickOption(opt.selector, false, doc); if (!ok) allOk = false; }
        }
        return allOk;
      }

      case 'fill_blank':
      case 'short_answer': {
        const text = answer.answer || '';
        if (!text) return false;
        // 限定在题目容器内找输入框：原逻辑用全局第一个 input，多道填空题会全部填进第一题的框。
        // 题目容器由 quiz-snapshot 打的 data-qku-q 锚点定位；找不到时再退回全局第一个（兼容）。
        let root = null;
        try { root = qs().findQuestionRoot && qs().findQuestionRoot(doc, question.index); } catch(e) {}
        const scope = (root && root !== doc.body) ? root : doc;
        // 输入框候选：原生 input/textarea + contenteditable 富文本框（如 jutiku 简答框）
        const CE_SEL = 'input[type=text], input:not([type]), textarea, [contenteditable]:not([contenteditable="false"])';
        const candidates = Array.from(scope.querySelectorAll(CE_SEL))
          .filter(e => !(e.closest && e.closest('.qku-answer-mark')));
        const input = candidates[0] || doc.querySelector(CE_SEL);
        if (!input) return false;
        // contenteditable 富文本：非表单元素，靠 textContent + input 事件写入
        const isCE = input.tagName !== 'INPUT' && input.tagName !== 'TEXTAREA'
          && input.getAttribute('contenteditable') != null
          && input.getAttribute('contenteditable').toLowerCase() !== 'false';
        qh().highlightElement && qh().highlightElement(buildSelector(input), doc);
        qh().showPanel && qh().showPanel('⌨ 填入', text.substring(0, 30), reason);
        if (!dryRun) {
          try { input.focus && input.focus(); } catch(e) {}
          if (isCE) {
            input.textContent = text;
            // 光标移到末尾，避免后续输入覆盖
            try {
              const d = doc || document;
              const range = d.createRange(); const so = d.getSelection && d.getSelection();
              range.selectNodeContents(input); range.collapse(false);
              if (so) { so.removeAllRanges(); so.addRange(range); }
            } catch(e) {}
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            input.value = text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        // 简单验证：写入后内容非空（填空无法比对内容，至少确认写入成功）
        const written = isCE ? (input.textContent || '').trim() : (input.value || '').trim();
        return !dryRun ? written.length > 0 : true;
      }

      default:
        qh().showPanel && qh().showPanel('⚠ 未知题型', '无法处理: ' + type, '请手动作答');
        return false;
    }
  }

  return { executeAnswer, clickOption };
})();
