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
    // contenteditable 富文本作答框（如 jutiku 的简答题）：排除 contenteditable="false"
    const editables = Array.from(root.querySelectorAll('[contenteditable]')).filter(e => {
      const v = (e.getAttribute('contenteditable') || '').toLowerCase();
      return v !== 'false';
    });
    const textInputs = root.querySelectorAll('input[type=text], input:not([type]), textarea');
    const text = (root.innerText || '').toLowerCase();
    if (checkboxes.length > 0 && checkboxes.length > radios.length) return 'multi_choice';
    if (radios.length >= 2 && (text.includes('正确') || text.includes('错误'))) return 'true_false';
    if (radios.length >= 2) return 'single_choice';
    if (radios.length === 1) return 'single_choice';
    if (editables.length > 0) return 'short_answer';
    if (textInputs.length > 0) {
      if (root.querySelectorAll('textarea').length > 0) return 'short_answer';
      return 'fill_blank';
    }
    return 'unknown';
  }

  function extractOptions(root) {
    const opts = [];
    const seen = new Set();
    const push = (el, rawText, inputType, checked) => {
      const t = clean(rawText);
      if (t && !seen.has(t)) { seen.add(t); opts.push({ index: opts.length, text: t, tag: 'option', inputType, checked, selector: buildSelector(el) }); }
    };
    // 1) label 包裹 input（原生表单控件，最可靠）
    root.querySelectorAll('label').forEach(label => {
      if (!visible(label)) return;
      const input = label.querySelector('input[type=radio], input[type=checkbox]');
      if (!input) return;
      push(label, label.textContent, input.type, input.checked);
    });
    if (opts.length) return opts.slice(0, MAX_OPTIONS);
    // 2) ARIA 控件：role=radio / role=checkbox（自绘无障碍选项，如 div 仿单选）
    //    KiKi 式"任意 UI"在这里用标准化语义兜底，而非让 LLM 猜选择器。
    root.querySelectorAll('[role="radio"],[role="checkbox"]').forEach(el => {
      if (!visible(el)) return;
      const t = clean(el.getAttribute('aria-label') || el.textContent);
      const checked = el.getAttribute('aria-checked') === 'true';
      const it = el.getAttribute('role') === 'checkbox' ? 'checkbox' : 'radio';
      push(el, t, it, checked);
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

  // 去掉被其它候选包含的"父块"，只保留最具体的题目容器（避免把整页当一题）
  function dedupeByContainment(els) {
    return els.filter((a, i) => !els.some((b, j) => i !== j && b !== a && b.contains(a)));
  }

  // 题目块打分：含可交互项越多、文本越像题干，分越高。
  // 这是"先识别结构"的核心——不靠写死的 class 第一个命中，而是对候选容器打分取优。
  function scoreQuestionBlock(el) {
    let score = 0;
    score += el.querySelectorAll('input[type=radio]').length * 3;
    score += el.querySelectorAll('input[type=checkbox]').length * 3;
    score += el.querySelectorAll('input[type=text], textarea, [contenteditable]:not([contenteditable="false"])').length * 2;
    const t = clean(el.textContent || '');
    if (t.length > 3) score += 1;
    return score;
  }

  // 通用题目块探测：标准 class 没命中时，扫描含可交互项的容器作为候选。
  function detectQuestionBlocks(rootDoc) {
    const doc = rootDoc || document;
    const sel = ['.question', '.quiz-item', '.exam-item', '.problem', '.q-item', '.test-item', '.item', 'fieldset', 'li'];
    let blocks = [];
    for (const s of sel) {
      blocks = blocks.concat(Array.from(doc.querySelectorAll(s)).filter(visible));
    }
    blocks = dedupeByContainment(blocks);
    return blocks.filter(b => scoreQuestionBlock(b) >= 3);
  }

  function findQuestionRoots(rootDoc) {
    const doc = rootDoc || document;
    // 1) EduSoho 优先（精确，行为不变）
    const ibsEls = Array.from(doc.querySelectorAll('.ibs-engine-item')).filter(visible);
    if (ibsEls.length > 0) {
      // 给每个 ibs-engine-item 打上 data-qa-index 和选项 data-qa-opt
      ibsEls.forEach((el, i) => { el.setAttribute('data-qa-index', String(i)); });
      ibsEls.forEach(el => {
        el.querySelectorAll('label.ibs-choose-item').forEach((lab, j) => { lab.setAttribute('data-qa-opt', String(j)); });
      });
      return ibsEls;
    }
    // 2) 标准选择器：收集全部候选 → 去重包含 → 按题目度过滤（取优，而非第一个命中）
    const selectors = ['[data-quiz]', '[data-quiz-item]', '[data-question]', '.question', '.quiz-item', '.exam-item', '.problem', 'fieldset'];
    let blocks = [];
    for (const sel of selectors) {
      blocks = blocks.concat(Array.from(doc.querySelectorAll(sel)).filter(visible));
    }
    blocks = dedupeByContainment(blocks);
    const scored = blocks.filter(b => scoreQuestionBlock(b) >= 3);
    if (scored.length > 0) return scored;
    // 3) 兜底探测：扫描含可交互项的容器（覆盖没有 per-question class 的页面）
    const probed = detectQuestionBlocks(doc);
    if (probed.length > 0) return probed;
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

      questions.push({
        index: qi, type: 'single_choice', stem: best.rest, options, order: '', score: '',
        _anchor: (anchor && anchor !== doc.body && anchor !== doc.documentElement) ? anchor : null
      });
    });
    return questions;
  }

  // 统一收集题目：先按容器提取；失败时（整页被当成 1 题）按 radio name 分组兜底
  // ===== 自绘选项通用切题（无原生 radio / 无 per-question class）=====
  // 适用：选项是自定义 div（如 jutiku 的 A/B/C/D 圆形字母标记），既没有 label>input，
  // 也没有 role=radio，且页面没有 per-question 容器 class。
  // 思路：先扫出所有"像选项"的元素（文本以 A./B) 等字母标记开头），再按字母连续性
  // 聚合成组，每组 = 一道题。这正是"先识别结构再识别题"的本地实现：
  // 不依赖任何站点 class，靠语义特征（字母选项组）理解页面结构。
  // 题干推断：从某组第一个选项往前找最近的非选项文本块（平铺/嵌套结构都适用）。
  // 自绘选项页面常无 per-question 容器，题干与选项平级，故不能取"整组共同祖先排除选项"
  // （那样会把整页当题干）。改为沿前兄弟链定位题干，遇第一个非选项文本即停。
  function firstPrefixText(startEl, groupSet, root) {
    let cur = startEl;
    while (cur && cur !== root) {
      let sib = cur.previousElementSibling;
      while (sib) {
        if (!groupSet.has(sib)) {
          const t = clean(sib.textContent || '');
          if (t) return t;
        }
        sib = sib.previousElementSibling;
      }
      cur = cur.parentElement;
    }
    return '';
  }

  function findLetterOptionUnits(doc) {
    // 字母标记后可跟标点（. ． 、 ） )））） 可选），再跟内容；长度限制排除整段正文
    const re = /^[A-Ja-j]\s*[.．、）)）]?\s*\S.{0,200}$/;
    // 严格版：字母后必须跟标点——用于排除题干误命中（如 "<span>His parents...</span>"
    // 以 H 开头且无标点，若无此校验会被当成选项 H，导致题干串进上一题的选项里）
    const rePunct = /^[A-Ja-j]\s*[.．、）)）]\s*\S.{0,200}$/;
    const all = Array.from(doc.querySelectorAll('*')).filter(el => {
      if (!visible(el)) return false;
      if (el.children.length > 10) return false;       // 容器太大，不是选项单元
      const t = clean(el.textContent);
      if (!re.test(t)) return false;
      // 字母必须是"独立字母子元素"（如 jutiku 的 <p><i>A</i><span>text</span></p>）
      // 或紧跟标点，二者必居其一；否则视为题干等噪声
      const dedicated = Array.from(el.children).some(c => /^[A-Ja-j]\s*[.．、）)）]?\s*$/.test(clean(c.textContent)));
      return dedicated || rePunct.test(t);
    });
    // 取最内层（排除被其它候选包含的父级）
    const inner = all.filter(a => !all.some(b => b !== a && b.contains(a)));
    return inner.filter(el => /^[A-J]\s*[.．、）)）]?/.test(clean(el.textContent)));
  }

  function splitByLetterOptions(rootDoc) {
    const doc = rootDoc || document;
    const units = findLetterOptionUnits(doc);
    if (units.length < 4) return [];                   // 至少够 2 题才切（避免误命中）
    // 按文档顺序分组：每组必须从 A 起步、字母严格递进（A→B→C…），
    // 容忍个别选项被过滤跳号（最多 +2），其余一律视为噪声丢弃——
    // 防止题干碎片等噪声混进选项组导致切错题（jutiku 真实页实测教训）。
    const groups = [];
    let cur = null;
    let expected = 66;                                 // 下一期望字母的 charCode（'B'）
    units.forEach(el => {
      const letter = clean(el.textContent)[0].toUpperCase().charCodeAt(0);
      if (letter === 65) {                             // 'A'：新题开始
        if (cur && cur.length >= 2) groups.push(cur);
        cur = [el];
        expected = 66;
        return;
      }
      if (!cur) return;                                // 没起步就遇到非 A：噪声
      if (letter >= expected && letter - expected <= 2) {
        cur.push(el);
        expected = letter + 1;
      }
      // 其余（字母倒退、跳跃过大）：噪声，丢弃
    });
    if (cur && cur.length >= 2) groups.push(cur);

    const groupSet = new Set();
    groups.forEach(g => g.forEach(el => groupSet.add(el)));

    const questions = [];
    let qi = 0;
    groups.forEach(group => {
      if (group.length < 2) return;                    // 少于 2 个选项不构成题
      // 最近共同祖先 = 题目容器
      let anchor = group[0];
      for (let up = 0; up < 8 && anchor; up++) {
        if (group.every(g => anchor.contains(g))) break;
        anchor = anchor.parentElement;
      }
      if (!anchor || anchor === doc.body || anchor === doc.documentElement) return;
      const labelSet = new Set(group);
      let stem = firstPrefixText(group[0], groupSet, anchor);
      if (!stem) stem = stemExcluding(anchor, labelSet) || clean(anchor.textContent).replace(clean(group[0].textContent), '').trim();
      const options = group.map((g, idx) => {
        const t = clean(g.textContent).replace(/^[A-Ja-j]\s*[.．、）)）]?\s*/, '');
        return { index: idx, text: t, tag: 'custom', inputType: 'custom', checked: false, selector: buildSelector(g) };
      });
      try { anchor.setAttribute('data-qku-q', String(qi)); } catch(e) {}
      questions.push({ index: qi, type: 'single_choice', stem, options, order: '', score: '', _anchor: anchor });
      qi++;
    });
    return questions;
  }

  // ===== 分节题型识别（通用）=====
  // 出卷惯例：题组前有"二、单选题 / 三、多选题 / 四、主观题"这类分节标题。
  // 不依赖任何站点 class，扫短文本标题即可拿到"此节之下题目的题型"。
  function detectSectionTypes(rootDoc) {
    const doc = rootDoc || document;
    const re = /^[（(]?[一二三四五六七八九十百0-9]{1,4}[）)]?\s*[、.．:：,，]?\s*(单选|多选|多项|判断|填空|简答|主观|论述|问答|名词解释)/;
    const TYPE_MAP = {
      '单选': 'single_choice', '多选': 'multi_choice', '多项': 'multi_choice',
      '判断': 'true_false', '填空': 'fill_blank',
      '简答': 'short_answer', '主观': 'short_answer', '论述': 'short_answer',
      '问答': 'short_answer', '名词解释': 'short_answer'
    };
    const cands = [];
    doc.querySelectorAll('h1,h2,h3,h4,h5,h6,b,strong,li,p,div,span,label,dt,th,td').forEach(el => {
      if (!visible(el)) return;
      const t = clean(el.textContent);
      if (!t || t.length > 12) return;                 // 分节标题都很短（"三、多项选择题"），排除正文/题干误命中
      const m = re.exec(t);
      if (m && TYPE_MAP[m[1]]) cands.push({ el, type: TYPE_MAP[m[1]], text: t });
    });
    // 只留最内层（父容器也含同样文本时，子节点更精确）
    return cands.filter(a => !cands.some(b => b !== a && b.el.contains(a.el)));
  }

  // ===== 文本作答题通用切题（主观/论述/填空：无选项，只有作答框）=====
  // 字母切题/radio 分组都只认"有选项"的题；主观题只有输入区，谁也看不见——
  // 这是混合卷漏题的根因。这里扫全页可见 textarea / contenteditable / text input，
  // 不在任何已识别题目容器内的，各自成题。锚点向上扩（不吞其它输入框），
  // 题干沿前兄弟链找（同字母切题的 firstPrefixText 思路）。
  function splitByTextInputs(rootDoc, excludeEls) {
    const doc = rootDoc || document;
    const excl = (excludeEls || []).filter(Boolean);
    // 登录/搜索/人机验证类输入框直接排除：按 name/id/placeholder 关键词
    const bad = /search|keyword|user(name)?|pass(word)?|captcha|phone|mobile|email|robot|human|验证码|安全验证|人机|用户名|密码|手机|邮箱|搜索|昵称/i;
    // 题干质量门槛：必须是"像题目"的文本，否则是评论区/校验框之类的噪声。
    // 通过条件：带问号/句号/冒号等标点，或含提问动词，或含填空下划线，或是编号开头。
    const stemOk = (s) => {
      const t = clean(s || '');
      if (t.length < 4) return false;
      if (bad.test(t)) return false;
      return /[？?。.：:；;]|_{2,}|＿{2,}|^\s*[（(]?\d{1,3}[.、)）]|请|简述|说明|论述|分析|解释|计算|翻译|写作|改错/.test(t);
    };
    const candidates = Array.from(doc.querySelectorAll(
      'textarea, [contenteditable="true"], [contenteditable=""], input[type=text], input:not([type])'
    )).filter(el => {
      if (!visible(el)) return false;
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (t && t !== 'text') return false;
      const key = (el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('placeholder') || '');
      if (bad.test(key)) return false;
      if (el.closest && el.closest('.qku-answer-mark')) return false;
      return !excl.some(a => { try { return a.contains(el); } catch(e) { return false; } });
    });
    const questions = [];
    candidates.forEach(input => {
      // 锚点向上扩：找能包住本输入框、又不吞其它输入框的最近祖先
      let anchor = input;
      for (let up = 0; up < 4; up++) {
        const p = anchor.parentElement;
        if (!p || p === doc.body || p === doc.documentElement) break;
        if (candidates.some(c => c !== input && p.contains(c))) break;
        anchor = p;
      }
      const rich = input.tagName === 'TEXTAREA' || input.getAttribute('contenteditable') !== null;
      const stem = firstPrefixText(input, new Set(), doc.body);
      if (!stemOk(stem)) return;                          // 题干不像题目：判为噪声（评论区/校验框）
      questions.push({
        index: 0, type: rich ? 'short_answer' : 'fill_blank',
        stem: stem || '', options: [], order: '', score: '', _anchor: anchor
      });
    });
    return questions;
  }

  // ===== 统一收集：多策略并行 + 按文档序合并（通用"全识别"核心）=====
  // 老逻辑"赢者通吃"在混合卷上必然漏题：字母切题认出 6 道选择题就 return，
  // 同页的主观题/论述题（无选项）谁也看不见。改为：
  //   基础 = 容器/字母/radio 三策略中题数最多者
  //   + 叠加文本作答题（不在任何基础题目容器内的输入框）
  //   + 分节标题校正题型（"三、多选题"下的题不再被硬标成单选）
  //   + 按文档顺序重排编号、重打 data-qku-q 锚点
  let lastCollectDebug = null;
  function collectQuestions(doc) {
    const debug = { container: 0, letter: 0, radio: 0, text: 0, sections: [] };

    // 策略 1：容器级（标准 class / 打分探测 / EduSoho）
    const roots = findQuestionRoots(doc);
    roots.forEach((r, i) => { try { r.setAttribute('data-qku-q', String(i)); } catch(e) {} });
    const containerQ = roots.map((root, qi) => {
      const es = extractEduSoho(root);
      const qType = es ? es.type : detectType(root);
      const stem = es ? es.stem : extractStem(root);
      const options = es ? es.options : extractOptions(root);
      return { index: qi, type: qType, stem, options, order: es ? es.order : '', score: es ? es.score : '', _anchor: root };
    }).filter(q => q.type !== 'unknown');
    debug.container = containerQ.length;

    // 策略 2：字母选项组（自绘 A/B/C/D 选项）
    const letterQ = splitByLetterOptions(doc);
    debug.letter = letterQ.length;

    // 策略 3：radio name 分组（仅当容器级失效时参与竞争）
    const radioCount = doc.querySelectorAll('input[type=radio]').length;
    let radioQ = [];
    if (containerQ.length <= 1 && radioCount >= 4) {
      radioQ = extractRadioGroups(doc);
      debug.radio = radioQ.length;
    }

    // 基础 = 题数最多者
    let base = containerQ;
    if (letterQ.length > base.length) base = letterQ;
    if (radioQ.length > base.length) base = radioQ;

    // 叠加策略 4：文本作答题。排除集合只算"真题目容器"——
    // 容器策略退化到 body 的伪题不算，否则会把全页输入框都排除掉。
    const covered = base
      .map(q => q._anchor)
      .filter(a => a && a !== doc.body && a !== doc.documentElement);
    const textQ = splitByTextInputs(doc, covered);
    debug.text = textQ.length;

    // 合并 + 按文档顺序排序
    const DP_F = (typeof Node !== 'undefined' && Node.DOCUMENT_POSITION_FOLLOWING) || 4;
    const DP_P = (typeof Node !== 'undefined' && Node.DOCUMENT_POSITION_PRECEDING) || 2;
    const merged = base.concat(textQ).filter(q => q._anchor);
    merged.sort((a, b) => {
      try {
        const pos = a._anchor.compareDocumentPosition(b._anchor);
        if (pos & DP_F) return -1;
        if (pos & DP_P) return 1;
      } catch(e) {}
      return 0;
    });

    // 分节标题校正题型：找每个题锚点前面最近的分节标题
    const secTypes = detectSectionTypes(doc);
    debug.sections = secTypes.map(s => s.text);
    if (secTypes.length) {
      merged.forEach(q => {
        let best = null;
        secTypes.forEach(h => {
          try { if (h.el.compareDocumentPosition(q._anchor) & DP_F) best = h; } catch(e) {}
        });
        if (best) q.type = best.type;
      });
    }

    // 重新编号 + 重打锚点（索引变了 data-qku-q 必须跟着变，徽标才插得对）+ 剥离 DOM 引用
    // 注意：不能按锚点去重——平铺结构（题干和选项同层、无 per-question 容器）下，
    // 多道题共用同一个祖先锚点是正常现象，去重会把 3 道题合并成 1 道（实测踩过）。
    const out = [];
    merged.forEach(q => {
      q.index = out.length;
      try {
        if (q._anchor !== doc.body && q._anchor !== doc.documentElement) {
          q._anchor.setAttribute('data-qku-q', String(q.index));
        }
      } catch(e) {}
      delete q._anchor;
      out.push(q);
    });
    lastCollectDebug = debug;
    log('collect strategies:', JSON.stringify(debug), '→', out.length, '题');
    return out;
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
      submitButtons: submitBtns,
      debug: lastCollectDebug || {}
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

  return { takeSnapshot, findTestpaperIframe, findTaskIframe, buildSelector, visible, findQuestionRoot, findQuestionRoots };
})();