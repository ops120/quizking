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

  async function clickOption(selector, dryRun, doc) {
    if (dryRun) return true;
    try {
      const el = findEl(doc, selector);
      if (!el) {
        log('element not found:', selector, '| doc 是 iframe?', !!(doc && doc !== document));
        return false;
      }
      log('click:', selector, '| tag=', el.tagName, '| disabled=', !!el.disabled);
      el.click();
      return true;
    } catch(e) {
      log('原生 click 失败，降级事件序列:', e.message);
      // force click 降级：完整事件序列以兼容 React/Vue/Angular
      try {
        const el = findEl(doc, selector);
        if (el) {
          const opts = { bubbles: true, cancelable: true, view: doc?.defaultView || window };
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
          // Pointer events for modern frameworks
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new PointerEvent('pointerup', opts));
          log('事件序列点击完成:', selector);
          return true;
        }
        log('事件序列点击失败：元素仍未找到');
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

        for (const idx of indices) {
          const opt = question.options[idx];
          if (!opt || !opt.selector) continue;
          qh().highlightElement && qh().highlightElement(opt.selector, doc);
          qh().showPanel && qh().showPanel('☑ 多选', '[' + opt.text + ']', reason);
          if (!dryRun) { await sleep(200); await clickOption(opt.selector, false, doc); }
        }
        return true;
      }

      case 'fill_blank':
      case 'short_answer': {
        const text = answer.answer || '';
        if (!text) return false;
        // 找第一个 input/textarea
        const input = doc.querySelector('input[type=text], input:not([type]), textarea');
        if (!input) return false;
        qh().highlightElement && qh().highlightElement(buildSelector(input), doc);
        qh().showPanel && qh().showPanel('⌨ 填入', text.substring(0, 30), reason);
        if (!dryRun) {
          input.value = text;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
      }

      default:
        qh().showPanel && qh().showPanel('⚠ 未知题型', '无法处理: ' + type, '请手动作答');
        return false;
    }
  }

  return { executeAnswer, clickOption };
})();
