/**
 * QuizKing Ultimate — quiz-snapshot.js
 * DOM 题目结构提取：支持 EduSoho (ibs-engine) + 通用 HTML 题库
 * 来源：interface-assistant 移植 + 增强
 */

window.QuizSnapshot = (() => {
  const MAX_OPTIONS = 10;

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  }

  function clean(t) { return (t || '').trim().replace(/\s+/g, ' '); }

  function buildSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const path = [];
    let node = el;
    while (node && node !== document.body && path.length < 5) {
      let seg = node.tagName.toLowerCase();
      if (node.className && typeof node.className === 'string') {
        const cls = node.className.trim().split(/\s+/).filter(c => c && c.indexOf(':') === -1)[0];
        if (cls) seg += '.' + CSS.escape(cls);
      }
      if (node.id) { path.unshift('#' + CSS.escape(node.id)); break; }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(s => s.tagName === node.tagName);
        if (siblings.length > 1) seg += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      path.unshift(seg);
      node = parent;
    }
    return path.join(' > ');
  }

  // ===== EduSoho 专用提取 =====
  function extractEduSoho(root) {
    const tagEl = root.querySelector('.answer-mode-tag');
    const tagText = tagEl ? clean(tagEl.textContent) : '';
    let type = '';
    if (tagText.includes('多选')) type = 'multi_choice';
    else if (tagText.includes('判断')) type = 'true_false';
    else if (tagText.includes('填空')) type = 'fill_blank';
    else if (tagText.includes('简答')) type = 'short_answer';
    else if (tagText.includes('单选')) type = 'single_choice';
    else if (tagText.includes('材料')) type = 'multi_choice'; // 材料题即为多选题
    if (!type) return null;

    const stemEl = root.querySelector('.ibs-stem');
    const stem = stemEl ? clean(stemEl.textContent) : '';

    const qid = root.getAttribute('data-qa-index');
    const opts = [];
    root.querySelectorAll('label.ibs-choose-item').forEach(label => {
      if (!visible(label)) return;
      const input = label.querySelector('input[type=radio], input[type=checkbox]');
      if (!input) return;
      let text = clean(label.textContent);
      text = text.replace(/^[A-Za-z]\s*[.．、]\s*/, '');
      const oid = label.getAttribute('data-qa-opt');
      const sel = (qid !== null && oid !== null)
        ? '.ibs-engine-item[data-qa-index="' + qid + '"] label.ibs-choose-item[data-qa-opt="' + oid + '"]'
        : buildSelector(label);
      if (text) opts.push({ index: opts.length, text, tag: 'label', inputType: input.type, checked: input.checked, selector: sel });
    });

    const orderEl = root.querySelector('.ibs-order');
    const scoreEl = root.querySelector('.ibs-score-tag');
    return { type, stem, options: opts, order: orderEl ? clean(orderEl.textContent) : '', score: scoreEl ? clean(scoreEl.textContent) : '' };
  }

  // ===== 通用题型检测 =====
  function detectType(root) {
    const typeAttr = (root.getAttribute('data-quiz-type') || root.getAttribute('data-type') || '').toLowerCase();
    if (typeAttr) return typeAttr;
    const radios = root.querySelectorAll('input[type=radio]');
    const checkboxes = root.querySelectorAll('input[type=checkbox]');
    const textInputs = root.querySelectorAll('input[type=text], input:not([type]), textarea');
    const text = (root.innerText || '').toLowerCase();
    if (checkboxes.length > 0 && checkboxes.length > radios.length) return 'multi_choice';
    if (radios.length >= 2 && (text.includes('正确') || text.includes('错误'))) return 'true_false';
    if (radios.length >= 2) return 'single_choice';
    if (radios.length === 1) return 'single_choice';
    if (textInputs.length > 0) {
      if (root.querySelectorAll('textarea').length > 0) return 'short_answer';
      return 'fill_blank';
    }
    return 'unknown';
  }

  function extractOptions(root) {
    const opts = [];
    const seen = new Set();
    // label 包裹 input
    root.querySelectorAll('label').forEach(label => {
      if (!visible(label)) return;
      const input = label.querySelector('input[type=radio], input[type=checkbox]');
      if (!input) return;
      const text = clean(label.textContent);
      if (text && !seen.has(text)) {
        seen.add(text);
        opts.push({ index: opts.length, text, tag: 'label', inputType: input.type, checked: input.checked, selector: buildSelector(label) });
      }
    });
    return opts.slice(0, MAX_OPTIONS);
  }

  function extractStem(root) {
    const blocks = root.querySelectorAll('h1,h2,h3,h4,p,.question-stem,.stem,[data-stem]');
    let best = '';
    blocks.forEach(b => {
      if (!visible(b)) return;
      const t = clean(b.textContent || b.innerText);
      if (t.length > best.length) best = t;
    });
    return best;
  }

  function findQuestionRoots(rootDoc) {
    const doc = rootDoc || document;
    // 优先 EduSoho
    const ibsEls = Array.from(doc.querySelectorAll('.ibs-engine-item')).filter(visible);
    if (ibsEls.length > 0) {
      // 给每个 ibs-engine-item 打上 data-qa-index 和选项 data-qa-opt
      ibsEls.forEach((el, i) => { el.setAttribute('data-qa-index', String(i)); });
      ibsEls.forEach(el => {
        el.querySelectorAll('label.ibs-choose-item').forEach((lab, j) => { lab.setAttribute('data-qa-opt', String(j)); });
      });
      return ibsEls;
    }
    // 通用选择器
    const selectors = ['[data-quiz]', '[data-quiz-item]', '[data-question]', '.question', '.quiz-item', '.exam-item', '.problem', 'fieldset'];
    for (const sel of selectors) {
      const els = Array.from(doc.querySelectorAll(sel)).filter(visible);
      if (els.length > 0) return els;
    }
    return [doc.body];
  }

  function log(...a) { try { console.log('[snapshot]', ...a); } catch(e) {} }

  // 题干 = 容器内**排除选项元素之后**的文本。
  // 不能用字符串替换剥选项：选项文本若是 "1"/"2" 这类单字符，会把题干里的
  // 同名字符一起吃掉（如题干 "1+1=?" 被剥成 ") + =?"）。用 TreeWalker 按元素排除。
  // 还必须排除行内答案徽标（.qku-answer-mark）：徽标是题目容器的兄弟节点，
  // 当向上回退到共同祖先时它会落入遍历子树，不排除就会把答案文本算进题干。
  function stemExcluding(container, labelSet) {
    const doc = container.ownerDocument || document;
    const parts = [];
    try {
      const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          let p = node.parentElement;
          while (p) {
            if (labelSet.has(p)) return NodeFilter.FILTER_REJECT; // 选项元素自身也要排除
            if (p.classList && p.classList.contains('qku-answer-mark')) return NodeFilter.FILTER_REJECT; // 自有徽标节点
            if (p === container) break;
            p = p.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let n;
      while ((n = walker.nextNode())) {
        const t = (n.nodeValue || '').trim();
        if (t) parts.push(t);
      }
    } catch(e) { /* 老浏览器降级：退回整体文本 */ }
    return clean(parts.join(' '));
  }

  // ===== 通用兜底：按 radio 的 name 分组切题 =====
  // 同一 name 的 radio 互斥，天然构成一道题。适用于题目被 JS 渲染进同一个
  // 容器、没有 per-question 类名的页面（如剑桥 Test Your English：
  // #quizForm 下每题只是一个裸 div，只有 input[name=qN] 能区分）。
  function extractRadioGroups(rootDoc) {
    const doc = rootDoc || document;
    const radios = Array.from(doc.querySelectorAll('input[type=radio]')).filter(visible);
    if (!radios.length) return [];

    // 按 name 分组，保持文档顺序；无 name 的各自成组
    const order = [];
    const groups = {};
    radios.forEach(r => {
      const key = r.name || ('__anon' + order.length);
      if (!(key in groups)) { groups[key] = []; order.push(key); }
      groups[key].push(r);
    });

    const questions = [];
    order.forEach((key, qi) => {
      const rs = groups[key];
      if (rs.length < 2) return;              // 少于 2 个选项不构成选择题
      const labels = rs.map(r => r.closest('label') || r.parentElement || r);
      const optTexts = labels.map(l => clean(l.textContent));
      if (optTexts.some(t => !t)) return;     // 有空选项文本，结构不完整，跳过

      // 题干容器 = 包含整组选项、且题干最短的祖先。
      // 最短意味着它紧包住本题，不会把别题的题干/选项算进来。
      const labelSet = new Set(labels);
      let best = null;
      let node = labels[0];
      for (let up = 0; up < 6 && node; up++) {
        const rest = stemExcluding(node, labelSet);
        if (rest.length >= 2 && (!best || rest.length < best.rest.length)) best = { rest };
        node = node.parentElement;
      }
      if (!best) return;

      const options = labels.map((l, i) => ({
        index: i, text: optTexts[i], tag: 'label', inputType: 'radio',
        checked: rs[i].checked, selector: buildSelector(l)
      })).slice(0, MAX_OPTIONS);

      // 徽标锚点：包含本组全部选项的最近祖先。兜底路径下题目索引来自分组而非
      // 容器，必须在这里重新打 data-qku-q，否则 answer-badge 会插错位置。
      // body/文档元素没有"题目"语义，不标记（answer-badge 也会拒绝这种 root）。
      let anchor = labels[0];
      for (let up = 0; up < 6 && anchor; up++) {
        if (labels.every(l => anchor.contains(l))) break;
        anchor = anchor.parentElement;
      }
      if (anchor && anchor !== doc.body && anchor !== doc.documentElement) {
        try { anchor.setAttribute('data-qku-q', String(qi)); } catch(e) {}
      }

      questions.push({ index: qi, type: 'single_choice', stem: best.rest, options, order: '', score: '' });
    });
    return questions;
  }

  // 统一收集题目：先按容器提取；失败时（整页被当成 1 题）按 radio name 分组兜底
  function collectQuestions(doc) {
    const roots = findQuestionRoots(doc);
    // 给每个题目容器打锚点：answer-badge.js 靠 data-qku-q 把答案徽标插回对应题目旁。
    // 与沉浸式翻译的 data-imt-p 同一思想——增量重扫时靠锚点界定边界，不整页重来。
    roots.forEach((r, i) => { try { r.setAttribute('data-qku-q', String(i)); } catch(e) {} });
    const questions = roots.map((root, qi) => {
      const es = extractEduSoho(root);
      const qType = es ? es.type : detectType(root);
      const stem = es ? es.stem : extractStem(root);
      const options = es ? es.options : extractOptions(root);
      return { index: qi, type: qType, stem, options, order: es ? es.order : '', score: es ? es.score : '' };
    }).filter(q => q.type !== 'unknown');

    // 兜底切分：容器级提取只得到 ≤1 题、但页面存在多组 radio（≥4 个）时，
    // 说明题目被渲染进了同一个容器，改用 radio name 分组重新切题。
    const radioCount = doc.querySelectorAll('input[type=radio]').length;
    if (questions.length <= 1 && radioCount >= 4) {
      const grouped = extractRadioGroups(doc);
      if (grouped.length > questions.length) {
        log('radio-group split:', grouped.length, 'questions (container-based gave', questions.length + ')');
        return grouped;
      }
    }
    return questions;
  }

  // rootDoc：传入 iframe 的 document 可提取跨域/同源 iframe 内的题目；缺省用顶层文档
  function takeSnapshot(rootDoc) {    const doc = rootDoc || document;
    const questions = collectQuestions(doc);

    // 提交按钮检测
    const submitRe = /(提交|交\s*卷|交卷|确认交卷)/;
    const submitBtns = Array.from(doc.querySelectorAll('button, a, input[type=submit]'))
      .filter(visible)
      .filter(el => {
        const t = clean(el.textContent || el.value || '');
        return submitRe.test(t) || el.matches('button[type=submit], input[type=submit], [data-submit], .submit, #submit');
      })
      .map((el, i) => ({ index: i, text: clean(el.textContent || el.value), selector: buildSelector(el) }));

    return {
      url: doc.URL || location.href,
      title: doc.title || document.title,
      questions,
      totalQuestions: questions.length,
      submitButtons: submitBtns
    };
  }

  // ===== iframe 发现 =====
  function findTestpaperIframe() {
    // 遍历所有 iframe 找试卷 URL
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.src || '';
      if (/\/testpaper\/\d+\/do|\/lesson\/\d+\/(testpaper|exam)/.test(src)) {
        return src;
      }
    }
    return null;
  }

  function findTaskIframe() {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = iframe.src || '';
      if (/activity_show/.test(src)) return { el: iframe, src };
    }
    return null;
  }

  // 按 collectQuestions 打下的 data-qku-q 锚点找回题目容器元素。
  // answer-badge.js 用它在题目容器后插入答案徽标（兄弟节点，不动题目自身 DOM）。
  // rootDoc：与 takeSnapshot 一致，可传 iframe 的 document。
  function findQuestionRoot(rootDoc, index) {
    const doc = rootDoc || document;
    try {
      return doc.querySelector('[data-qku-q="' + index + '"]');
    } catch(e) { return null; }
  }

  return { takeSnapshot, findTestpaperIframe, findTaskIframe, buildSelector, visible, findQuestionRoot };
})();