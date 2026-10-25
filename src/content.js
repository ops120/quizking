/**
 * QuizKing Ultimate — content.js
 * 注入任意页面的内容脚本：采集 + 问答 + 自动答题 + 视觉反馈 + 交卷拦截
 */
(() => {
  if (window.__qku_injected__) return;
  window.__qku_injected__ = true;

  const ROOT_ID = 'aqh-root';
  let cfg = null, promptMode = 'reason';
  let activeReq = null;
  let autoAnswering = false;
  let paused = false;

  // ===== 工具函数 =====
  function log(...a) { try { console.log('[qku]', ...a); } catch(e) {} }

  // 诊断：既写 console.error（默认不过滤），也攒起来在失败时直接渲染进气泡，
  // 免得用户到处找控制台。force 渲染可绕过静默模式。
  let diagLines = [];
  function diag(...a) {
    let line;
    try { line = a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); } catch(e) { line = a.join(' '); }
    diagLines.push(line);
    try { console.error('[qku-diag]', line); } catch(e) {}
    if (diagLines.length > 40) diagLines.shift();
  }
  function flushDiag() {
    if (!diagLines.length) return;
    renderBubble(
      '<div class="aqh-reasoning-block"><div class="aqh-reasoning-label">诊断信息（' + diagLines.length + ' 条）</div>' +
      '<div class="aqh-pre" style="max-height:220px;overflow:auto;font-size:11px">' + escapeHtml(diagLines.join('\n')) + '</div></div>',
      { force: true, status: '诊断' }
    );
  }
  function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function callBg(type, payload, timeoutMs = 10000) {
    return new Promise(resolve => {
      try {
        const timer = setTimeout(() => resolve({ ok: false, error: '消息超时（' + timeoutMs + 'ms）' }), timeoutMs);
        chrome.runtime.sendMessage({ type, payload }, res => {
          clearTimeout(timer);
          resolve(res);
        });
      } catch(e) {
        resolve({ ok: false, error: e?.message || String(e) });
      }
    });
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // 静默模式下推送状态到 background（popup 显示用）
  function pushStatus(text, loading) {
    if (cfg?.silentMode) {
      callBg('aqh/status-update', { text, loading });
    }
  }

  // ===== 气泡 UI（简化版） =====
  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.documentElement.appendChild(root);
    return root;
  }

  function renderBubble(html, opts) {
    // 静默模式不弹气泡（opts.force 可强制弹出，用于互斥提示等必要场景）
    if (cfg?.silentMode && !(opts && opts.force)) return;
    opts = opts || {};
    const root = ensureRoot();
    root.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.id = 'aqh-bubble';
    const o = Number((cfg?.bubbleOpacity) ?? 0.95);
    wrap.style.setProperty('--aqh-o', String(Math.min(1, Math.max(0.4, o))));
    wrap.innerHTML =
      '<div id="aqh-header"><div id="aqh-title"><span id="aqh-title-glyph">王</span><span>答题王Ultimate</span></div>' +
      '<div id="aqh-actions"><button data-act="options" title="设置">⚙</button><button data-act="min" title="隐藏">—</button><button data-act="close" title="关闭">✕</button></div></div>' +
      '<div id="aqh-body">' + html + '</div>' +
      '<div id="aqh-status">' + (opts.status || '') + '</div>';
    root.appendChild(wrap);

    wrap.querySelector('[data-act="close"]').onclick = closeBubble;
    wrap.querySelector('[data-act="min"]').onclick = () => wrap.classList.toggle('aqh-hide');
    wrap.querySelector('[data-act="options"]').onclick = () => { try { chrome.runtime.openOptionsPage(); } catch(e) {} };
    enableDrag(wrap, wrap.querySelector('#aqh-header'));
  }

  function setStatus(text, loading) {
    pushStatus(text, loading);
    if (cfg?.silentMode) return;
    const st = document.getElementById('aqh-status');
    if (!st) return;
    st.innerHTML = loading ? '<span class="aqh-spinner"></span>' + escapeHtml(text) : escapeHtml(text||'');
  }

  function closeBubble() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.innerHTML = '';
    window.QuizHighlight?.cleanup();
  }

  function enableDrag(box, handle) {
    let sx=0,sy=0,ox=0,oy=0,dragging=false;
    handle.addEventListener('mousedown', e => {
      dragging=true;const r=box.getBoundingClientRect();ox=r.left;oy=r.top;sx=e.clientX;sy=e.clientY;e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if(!dragging)return;
      box.style.left=Math.max(0,Math.min(window.innerWidth-80,ox+(e.clientX-sx)))+'px';
      box.style.top=Math.max(0,Math.min(window.innerHeight-40,oy+(e.clientY-sy)))+'px';
      box.style.right='auto';box.style.bottom='auto';
    });
    window.addEventListener('mouseup',()=>{dragging=false;});
  }

  // ===== 原 QuizKing 单次问答 =====
  async function askAndShow(payload, label) {
    if (!cfg?.hasKey) {
      renderBubble('<div class="aqh-err">未配置 API Key。右键→选项页配置。</div>', { status: '需要配置' });
      return;
    }
    const n = (cfg.providers||[]).filter(p=>p.enabled&&p.hasKey).length;
    // 静默模式下不弹气泡，但请求仍走后台（结果不可见）
    if (cfg?.silentMode) {
      setStatus('正在向 ' + n + ' 个模型发送请求…', true);
    } else {
      setStatus('正在向 ' + n + ' 个模型发送请求…', true);
      renderBubble(
        '<div class="aqh-reasoning-block"><div class="aqh-reasoning-label">已捕获</div>' + escapeHtml(label||'') + '</div>',
        { status: '正在向 ' + n + ' 个模型发送请求…', loading: true }
      );
    }
    const res = await callBg('aqh/ask', payload, 30000);
    if (!res?.ok) { setStatus('失败：' + ((res?.error)||'未知')); return; }
    beginIncremental(res.result, label);
  }

  function beginIncremental(result, label) {
    const roster = result.pending || [];
    activeReq = { reqId: result.reqId, roster, items: {}, promptMode: result.promptMode, label: label||'' };
    if (roster.length <= 1) return;
    renderProgress();
  }

  function currentItems() {
    if (!activeReq) return [];
    return activeReq.roster.map(p => activeReq.items[p.id] || { id: p.id, label: p.label, model: p.model, ok: null });
  }

  function renderProgress() {
    const st = activeReq; if (!st) return;
    const body = document.getElementById('aqh-body'); if (!body) return;
    const items = currentItems();
    body.innerHTML = '';
    renderMulti(body, items, st.promptMode, st.label);
    const arrived = items.filter(it => it.ok !== null).length;
    setStatus(arrived < items.length ? ('已返回 '+arrived+'/'+items.length+'，等待其余…') : '完成。', arrived < items.length);
  }

  function normAnswer(s) { return String(s||'').trim().toUpperCase().replace(/\s+/g, ''); }

  function renderMulti(body, items, mode, label) {
    const okItems = items.filter(it => it.ok === true);
    const allSame = okItems.length > 1 && okItems.every(it => normAnswer(it.answer) === normAnswer(okItems[0].answer));
    const badge = document.createElement('div');
    let badgeText;
    if (okItems.length === 0 && items.length === 1) {
      badgeText = '等待结果…';
    } else if (okItems.length === 0) {
      badgeText = '等待模型返回…';
    } else {
      badgeText = allSame ? ('✓ '+okItems.length+' 个模型答案一致') : '⚠ 答案不一致';
    }
    badge.className = 'aqh-consensus ' + (allSame ? 'aqh-same' : okItems.length > 1 ? 'aqh-diff' : '');
    badge.textContent = badgeText;
    body.appendChild(badge);

    items.forEach(it => {
      const card = document.createElement('div');
      card.className = 'aqh-item' + (it.ok === false ? ' aqh-item-fail' : '');
      if (it.ok === null) { card.innerHTML = '<div class="aqh-item-head"><span class="aqh-item-label">' + escapeHtml(it.label) + '</span><span class="aqh-item-ms">等待中…</span></div>'; }
      else if (!it.ok) { card.innerHTML = '<div class="aqh-item-head"><span class="aqh-item-label">' + escapeHtml(it.label) + '</span></div><div class="aqh-err">' + escapeHtml(it.error) + '</div>'; }
      else {
        card.innerHTML =
          '<div class="aqh-item-head"><span class="aqh-item-label">' + escapeHtml(it.label) + '</span><span class="aqh-item-model">' + escapeHtml(it.model) + '</span><span class="aqh-item-ms">' + ((it.ms/1000).toFixed(1)) + 's</span></div>' +
          '<div class="aqh-answer-block">' + escapeHtml(it.answer||'') + '</div>' +
          (it.reasoning ? '<details class="aqh-item-reason"><summary>解析</summary><div class="aqh-reasoning-block">' + escapeHtml(it.reasoning) + '</div></details>' : '');
      }
      body.appendChild(card);
    });
  }

  // ===== 单服务商 plain layout（参考原版 QuizKing）=====
  function renderSingle(body, answerRaw, reasoningRaw, raw, modeIn) {
    const answer = String(answerRaw || '').trim();
    const reasoning = String(reasoningRaw || '').trim();
    const mode = modeIn || promptMode || 'reason';
    const showReasoning = mode !== 'answer' && !!reasoning && reasoning !== answer;

    if (answer) {
      const a = document.createElement('div');
      a.className = 'aqh-answer';
      a.innerHTML = '<div class="aqh-answer-label">答案</div><div class="aqh-answer-block"></div>';
      a.querySelector('.aqh-answer-block').textContent = answer;
      body.appendChild(a);
    }
    if (showReasoning) {
      const re = document.createElement('div');
      re.className = 'aqh-reasoning';
      re.style.marginTop = '8px';
      re.innerHTML = '<div class="aqh-reasoning-label">解析</div><div class="aqh-reasoning-block"></div>';
      re.querySelector('.aqh-reasoning-block').textContent = reasoning;
      body.appendChild(re);
    }
    if (!answer && !reasoning && raw) {
      const rw = document.createElement('div');
      rw.style.marginTop = '8px';
      rw.innerHTML = '<div class="aqh-reasoning-label">原始输出</div><div class="aqh-pre"></div>';
      rw.querySelector('.aqh-pre').textContent = String(raw);
      body.appendChild(rw);
    }
  }

  // ===== 三通道采集 =====
  function getSelectionText() {
    const sel = window.getSelection?.();
    return sel ? sel.toString().trim() : '';
  }

  async function captureVisibleScreenshot() {
    const res = await callBg('aqh/capture-visible-tab');
    if (!res?.ok) throw new Error((res?.error) || '截图失败');
    return res.dataUrl;
  }

  async function chooseCropAndCapture() {
    const full = await captureVisibleScreenshot();
    const rect = await pickRectOnPage();
    if (!rect) return full;
    return cropDataUrl(full, rect);
  }

  function pickRectOnPage() {
    return new Promise(resolve => {
      const mask = document.createElement('div'); mask.id='aqh-mask'; mask.className='aqh-mask';
      document.documentElement.appendChild(mask);
      const hint = document.createElement('div'); hint.id='aqh-mask-hint'; hint.className='aqh-mask-hint'; hint.textContent='拖动框选区域，ESC取消';
      document.documentElement.appendChild(hint);
      const sel = document.createElement('div'); sel.id='aqh-sel'; sel.className='aqh-sel';
      document.documentElement.appendChild(sel);

      // 遮罩层级低于气泡/FAB，框选期间先隐藏它们，保证右下角也能完整框选
      const hiddenEls = ['aqh-root', 'aqh-fab']
        .map(id => document.getElementById(id))
        .filter(Boolean);
      const prevDisplay = hiddenEls.map(el => el.style.display);
      hiddenEls.forEach(el => { el.style.display = 'none'; });

      let startX=0,startY=0,drawing=false,finished=false;

      // 清理函数：确保元素和监听器被正确移除
      function cleanup() {
        if (finished) return;
        finished = true;
        [mask,hint,sel].forEach(e => { if (e && e.parentNode) e.remove(); });
        hiddenEls.forEach((el, i) => { el.style.display = prevDisplay[i]; });
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('unload', cleanup);
      }
      
      function done(rect) {
        cleanup();
        resolve(rect);
      }
      
      function onDown(e){if(e.button!==0)return;e.preventDefault();startX=e.clientX;startY=e.clientY;sel.style.left=startX+'px';sel.style.top=startY+'px';sel.style.width='0';sel.style.height='0';sel.style.display='block';drawing=true;}
      function onMove(e){if(!drawing)return;const l=Math.min(startX,e.clientX),t=Math.min(startY,e.clientY);sel.style.left=l+'px';sel.style.top=t+'px';sel.style.width=Math.abs(e.clientX-startX)+'px';sel.style.height=Math.abs(e.clientY-startY)+'px';}
      function onUp(e){if(!drawing)return;drawing=false;const w=Math.abs(e.clientX-startX),h=Math.abs(e.clientY-startY);if(w<3||h<3)return done(null);done({left:Math.min(startX,e.clientX),top:Math.min(startY,e.clientY),width:w,height:h,dpr:window.devicePixelRatio||1});}
      function onKey(e){if(e.key==='Escape'){drawing=false;done(null);}}
      
      mask.addEventListener('mousedown',onDown);
      mask.addEventListener('mouseup',onUp);
      mask.addEventListener('contextmenu',e=>e.preventDefault());
      window.addEventListener('mousemove',onMove);
      window.addEventListener('keydown',onKey);
      window.addEventListener('unload', cleanup); // 页面卸载时清理
    });
  }

  function cropDataUrl(dataUrl, rect) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const dpr = rect.dpr||1;
        const c = document.createElement('canvas');
        c.width = Math.min(1600, rect.width*dpr); c.height = rect.height*dpr*(c.width/(rect.width*dpr));
        const ctx = c.getContext('2d');
        ctx.drawImage(img, rect.left*dpr, rect.top*dpr, rect.width*dpr, rect.height*dpr, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg',0.85));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // ===== 题目检测（只识别结构与可作答性，不调 LLM、不点击）=====
  const TYPE_NAMES = {
    single_choice: '单选', true_false: '判断', multi_choice: '多选',
    fill_blank: '填空', short_answer: '简答', unknown: '未知'
  };

  async function detectQuestions() {
    cfg = ((await callBg('aqh/get-config')) || {}).cfg || cfg;
    const QuizSnapshot = window.QuizSnapshot;
    if (!QuizSnapshot) {
      const msg = '检测组件未加载，请刷新页面后重试';
      setStatus(msg, false);
      return { ok: false, error: msg };
    }

    // 试卷 iframe：自动答题会先跳转进去，这里只提示，不跳转
    const testpaperUrl = QuizSnapshot.findTestpaperIframe();
    if (testpaperUrl) {
      const msg = '发现试卷 iframe，自动答题会先进入试卷页再检测';
      setStatus(msg, true);
      if (!cfg?.silentMode) renderBubble(
        '<div class="aqh-reasoning-block"><div class="aqh-reasoning-label">检测结果</div>' + escapeHtml(msg) + '</div>',
        { status: msg }
      );
      return { ok: true, actionable: false, needNavigate: true, message: msg };
    }

    // 定位题目所在文档：同源 iframe / 跨域 iframe / 主文档
    let targetDoc = document;
    const taskIframe = QuizSnapshot.findTaskIframe();
    if (taskIframe) {
      try {
        const doc = taskIframe.el.contentDocument || taskIframe.el.contentWindow.document;
        if (doc && doc.body) { targetDoc = doc; log('detect: using iframe document'); }
      } catch(e) {
        const msg = '跨域 iframe：父页读不到其文档，将交由页面内自行作答';
        setStatus(msg, false);
        if (!cfg?.silentMode) renderBubble(
          '<div class="aqh-reasoning-block"><div class="aqh-reasoning-label">检测结果</div>' + escapeHtml(msg) + '</div>',
          { status: '检测完成' }
        );
        return { ok: true, actionable: false, crossOrigin: true, message: msg };
      }
    }

    const snapshot = QuizSnapshot.takeSnapshot(targetDoc);
    const qs = snapshot.questions || [];

    if (!qs.length) {
      const msg = '未检测到可作答题目 —— 页面可能是纯文本真题（无可点击选项），请改用「选区」或「截图」通道';
      setStatus(msg, false);
      if (!cfg?.silentMode) renderBubble('<div class="aqh-err">' + escapeHtml(msg) + '</div>', { status: '检测完成' });
      return { ok: true, actionable: false, total: 0, message: msg };
    }

    // 题型统计 + 可点击性（有 selector 的选项才能自动点击）
    const byType = {};
    let clickable = 0;
    qs.forEach(q => {
      byType[q.type] = (byType[q.type] || 0) + 1;
      if (q.options && q.options.some(o => o.selector)) clickable++;
    });
    const typeText = Object.keys(byType).map(t => (TYPE_NAMES[t] || t) + ' ' + byType[t]).join('、');
    // LLM 配置状态一并报出：没配 Key 时自动答题必然全败，提前告知
    const activeCount = (cfg?.providers || []).filter(p => p.enabled && p.hasKey).length;
    const llmText = activeCount
      ? ('LLM ✓ ' + activeCount + ' 个可用服务商')
      : 'LLM ✗ 未配置可用服务商 —— 自动答题会全部失败，请先到选项页填写 API Key';
    const msg = '检测到 ' + qs.length + ' 题（' + typeText + '），其中 ' + clickable + ' 题可自动点击' +
      (snapshot.submitButtons?.length ? '；已识别交卷按钮（不会点击）' : '');

    setStatus(msg + '｜' + llmText, false);
    if (!cfg?.silentMode) {
      renderBubble(
        '<div class="aqh-reasoning-block"><div class="aqh-reasoning-label">检测结果</div>' + escapeHtml(msg) +
        '<div style="margin-top:6px;font-size:12px" class="' + (activeCount ? '' : 'aqh-err') + '">' + escapeHtml(llmText) + '</div>' +
        (clickable && activeCount ? '<div style="margin-top:8px"><button id="aqh-detect-go" class="aqh-btn-primary">开始自动作答</button></div>' : '') +
        '</div>',
        { status: '检测完成' }
      );
      const go = document.getElementById('aqh-detect-go');
      if (go) go.addEventListener('click', () => autoAnswer());
    }
    return { ok: true, actionable: clickable > 0 && activeCount > 0, total: qs.length, clickable, activeCount, byType, message: msg + '｜' + llmText };
  }

  // ===== 自动答题引擎 =====
  async function autoAnswer() {
    if (autoAnswering) {
      log('already auto-answering');
      return;
    }
    autoAnswering = true;
    paused = false; // 每次启动重置暂停状态，避免上次残留导致无限等待
    try {
      await autoAnswerInner();
    } catch (e) {
      log('autoAnswer crashed:', e);
      setStatus('自动答题异常中断：' + (e?.message || String(e)), false);
    } finally {
      autoAnswering = false; // 任何路径退出都释放锁，防止状态卡死
      paused = false;
    }
  }

  async function autoAnswerInner() {
    diagLines = [];
    // 刷新配置（静默模式等可随时改）
    cfg = ((await callBg('aqh/get-config')) || {}).cfg || cfg;
    diag('配置: silentMode=' + !!cfg?.silentMode, 'hasKey=' + !!cfg?.hasKey,
         'providers=' + (cfg?.providers || []).map(p => p.id + '(enabled=' + p.enabled + ',hasKey=' + p.hasKey + ',model=' + p.model + ')').join(',') || '(无)',
         'autoBatch=' + cfg?.autoBatch, 'autoDelay=' + cfg?.autoDelay);

    const { QuizSnapshot, QuizHighlight, AnswerExecutor } = window;
    if (!QuizSnapshot) { diag('QuizSnapshot 未加载'); log('QuizSnapshot not loaded'); return; }
    if (!QuizHighlight) { diag('QuizHighlight 未加载'); log('QuizHighlight not loaded'); return; }
    if (!AnswerExecutor) { diag('AnswerExecutor 未加载'); log('AnswerExecutor not loaded'); return; }

    // 检查是否在任务页（有 iframe）
    const taskIframe = QuizSnapshot.findTaskIframe();
    const testpaperUrl = QuizSnapshot.findTestpaperIframe();

    let targetDoc = document;
    if (testpaperUrl) {
      log('found testpaper iframe:', testpaperUrl);
      const silent = cfg?.silentMode;
      setStatus('发现试卷，正在进入试卷页…', true);
      if (!silent) {
        renderBubble(
          '<div class="aqh-reasoning-block"><div class="aqh-reasoning-label">发现试卷</div>' + escapeHtml(testpaperUrl) + '</div>',
          { status: '正在进入试卷页…', loading: true }
        );
      }
      window.location.href = testpaperUrl;
      return; // 导航后脚本会重新注入
    }

    if (taskIframe) {
      try {
        const doc = taskIframe.el.contentDocument || taskIframe.el.contentWindow.document;
        if (doc && doc.body) {
          targetDoc = doc;
          log('using iframe document');
        }
      } catch(e) {
        // 跨域 iframe：父页读不到其文档，由 iframe 内的 content script 自行作答。
        // 这里直接退出，避免误报"未检测到题目"并和 iframe 重复执行。
        log('cross-origin iframe, deferring to iframe self-service');
        setStatus('检测到跨域 iframe 试卷，已交由页面内自行作答…', true);
        return;
      }
    }

    // 获取快照（iframe 内的题目从 iframe 文档提取）
    const snapshot = QuizSnapshot.takeSnapshot(targetDoc);
    const silent = cfg?.silentMode;
    diag('快照: ' + snapshot.questions.length + ' 题,', 'submitButtons=' + (snapshot.submitButtons || []).length,
         'targetDoc=' + (targetDoc === document ? '主文档' : 'iframe'));
    snapshot.questions.slice(0, 6).forEach(q => {
      diag('  题' + q.index, q.type, '题干=' + JSON.stringify((q.stem || '').slice(0, 50)),
           '选项=' + q.options.length, '首选项selector=' + JSON.stringify((q.options[0] || {}).selector || null));
    });

    if (!snapshot.questions?.length) {
      const msg = '未检测到可作答题目 —— 页面可能是纯文本真题（无可点击选项），请改用「选区」或「截图」通道；' +
        '不确定页面是否支持时，可先用「🔍 检测题目」确认';
      setStatus(msg, false);
      if (!silent) renderBubble('<div class="aqh-err">' + escapeHtml(msg) + '</div>', { status: '失败' });
      return;
    }

    log('detected', snapshot.questions.length, 'questions');

    const batchSize = cfg?.autoBatch || 5;

    if (!silent) QuizHighlight?.showStatus('检测到 ' + snapshot.questions.length + ' 题，开始推理作答…', 'ok');
    // 无论是否静默，都推送进度到 background（popup 状态栏显示）
    setStatus('检测到 ' + snapshot.questions.length + ' 题，自动作答中…', true);

    if (!silent) {
      renderBubble(
        '<div style="padding:8px;font-size:13px;">🎯 检测到 <b>' + snapshot.questions.length + '</b> 题' +
        (snapshot.submitButtons?.length ? '<br>🔒 发现提交按钮「' + escapeHtml(snapshot.submitButtons[0].text) + '」— 不会点击' : '') +
        '<br>🧠 每批 <b>' + batchSize + '</b> 题并行推理…</div>',
        { status: '自动作答中…', loading: true }
      );
    }

    let answered = 0, failed = 0;

    // 分批并行推理
    const qs = snapshot.questions;

    // 行内答案徽标（选项页 inlineBadge 开关，默认关）：先清旧徽标再插占位，
    // 保证重复触发不叠徽标；占位盒固定高度，答案回来后原位替换，选项零位移。
    if (window.QuizBadge && cfg?.inlineBadge) {
      QuizBadge.configure(cfg);
      QuizBadge.clear(targetDoc);
      QuizBadge.renderPending(targetDoc, qs);
    }

    for (let batchStart = 0; batchStart < qs.length; batchStart += batchSize) {
      await waitIfPaused();
      const batch = qs.slice(batchStart, batchStart + batchSize);
      const batchEnd = Math.min(batchStart + batchSize, qs.length);
      setStatus('推理第 ' + (batchStart+1) + '-' + batchEnd + '/' + qs.length + ' 题…', true);

      // 整批并行推理（LLM 批量推理可能很慢，放宽到 3 分钟，避免被 10s 默认超时误杀）
      diag('发送批量推理请求: ' + batch.length + ' 题');
      const batchRes = await callBg('aqh/auto-answer-batch', { questions: batch }, 180000);
      log('batch', batchStart + 1, '-', batchEnd, '响应:', JSON.stringify(batchRes).slice(0, 600));
      diag('批量响应 ok=' + !!(batchRes && batchRes.ok),
           batchRes && batchRes.ok ? ('answers=' + (batchRes.answers || []).length) : ('error=' + ((batchRes && batchRes.error) || '(无 error 字段，响应为 ' + JSON.stringify(batchRes) + ')')));
      if (!batchRes?.ok) {
        // 整批失败：必须显式报错，不能静默 continue（否则只看到"N 失败"却无从判断原因）
        const err = (batchRes && batchRes.error) || '批量推理无响应（后台可能未返回，或消息通道已关闭）';
        failed += batch.length;
        log('batch FAILED:', err);
        diag('!! 整批失败:', err);
        setStatus('批量推理失败：' + err, false);
        if (!silent) QuizHighlight?.showPanel('❌ 批量推理失败', '第 ' + (batchStart+1) + '-' + batchEnd + ' 题', err);
        continue;
      }

      const answers = batchRes.answers || [];
      // 按 index 对齐回原题
      const answerMap = {};
      answers.forEach(a => { answerMap[a.index] = a; });

      // 逐题点击（点击必须串行，避免 UI 冲突）
      for (let j = 0; j < batch.length; j++) {
        await waitIfPaused();
        const q = batch[j];
        const res = answerMap[q.index];
        if (!silent) QuizHighlight?.showPanel('🖱 第 ' + (q.index+1) + ' 题', q.stem.substring(0, 60), '');

        if (!res?.ok) {
          failed++;
          const err = (res && res.error) || '（无错误信息）';
          log('题', q.index, '推理失败:', err, '| 原始返回:', JSON.stringify(res).slice(0, 300));
          diag('!! 题' + q.index, '推理失败:', err, '| 返回=', JSON.stringify(res).slice(0, 200));
          if (!silent) QuizHighlight?.showPanel('❌ 推理失败', '第 ' + (q.index+1) + ' 题', err);
          if (window.QuizBadge && cfg?.inlineBadge) QuizBadge.fillError(targetDoc, q, err);
          continue;
        }

        const answer = res.isMulti
          ? { answer: res.answer, reasoning: res.reasoning, optionIndices: res.optionIndices || [] }
          : { answer: res.answer, reasoning: res.reasoning, optionIndex: res.optionIndex };
        const label = res.isMulti
          ? (res.optionIndices || []).map(i => String.fromCharCode(65 + i)).join(',')
          : String.fromCharCode(65 + (res.optionIndex || 0));
        log('题', q.index, '答案:', JSON.stringify(res.answer).slice(0, 120), '→ 选项', label);
        diag('题' + q.index, '答案=', JSON.stringify((res.answer || '').slice(0, 60)), '→ 选项', label, 'optionIndex=' + res.optionIndex);
        if (!silent) QuizHighlight?.showPanel('✅ 答案', label, res.reasoning);

        const ok = await AnswerExecutor.executeAnswer(q, answer, { dryRun: false, doc: targetDoc });
        log('题', q.index, 'executeAnswer →', ok);
        diag('题' + q.index, 'executeAnswer →', ok);
        // 行内徽标：答案原位替换占位（盒子不变，选项不位移）；clicked 决定"已勾选/未勾选"
        if (window.QuizBadge && cfg?.inlineBadge) QuizBadge.fill(targetDoc, q, res, ok);
        if (ok) answered++; else {
          failed++;
          log('题', q.index, '点击失败，选项数据:', JSON.stringify(q.options).slice(0, 300));
          diag('!! 题' + q.index, '点击失败。选项数据=', JSON.stringify(q.options).slice(0, 250));
          if (!silent) QuizHighlight?.showPanel('❌ 点击失败', '第 ' + (q.index+1) + ' 题', '选项元素未找到或不可点击，请手动作答');
        }
        await sleep(cfg?.autoDelay || 300);
      }
    }

    // 检查提交按钮（结果状态无论是否静默都推送，popup 可见）
    const doneText = '✅ 完成！' + answered + '/' + snapshot.questions.length + ' 题已答' +
      (failed ? ('（' + failed + ' 失败）') : '') +
      (snapshot.submitButtons?.length ? '。交卷已拦截，请手动确认。' : '。');
    if (!silent) {
      if (snapshot.submitButtons?.length) {
        const btn = snapshot.submitButtons[0];
        QuizHighlight?.showPanel('🔒 完成', answered + '/' + snapshot.questions.length + ' 题已答（' + failed + ' 失败）', '未点击交卷按钮：「' + btn.text + '」。请自行检查后手动交卷。');
      } else {
        QuizHighlight?.showPanel('✅ 完成', answered + '/' + snapshot.questions.length + ' 题已答', '');
      }
    }
    setStatus(doneText, false);
    // 有失败就把诊断信息直接渲染出来（force 绕过静默模式），不必去翻控制台
    if (failed > 0) {
      diag('结果: ' + answered + ' 成功 / ' + failed + ' 失败');
      flushDiag();
    }
  }

  // ===== FAB 按钮 =====
  function ensureFab() {
    // 只在顶层 frame 注入 FAB，避免 iframe 重复
    if (window.top !== window) return null;
    let fab = document.getElementById('aqh-fab');
    if (fab) return fab;
    fab = document.createElement('button');
    fab.id = 'aqh-fab';
    fab.title = '答题王Ultimate';
    fab.textContent = '王';
    // 静态状态默认隐藏，避免页面右下角常驻气泡；通过 popup「王 按钮」或 Ctrl+Shift+H 召唤
    fab.style.display = 'none';
    document.documentElement.appendChild(fab);

    let expanded = false, collapseTimer = null;
    const render = () => {
      if (expanded) {
        fab.classList.add('aqh-fab-expanded');
        fab.innerHTML =
          '<span class="aqh-fab-btn" data-k="selection">选区</span>' +
          '<span class="aqh-fab-btn" data-k="visible">截图</span>' +
          '<span class="aqh-fab-btn" data-k="detect">🔍检测</span>' +
          '<span class="aqh-fab-btn" data-k="auto">🚀自动答题</span>';
        fab.querySelectorAll('[data-k]').forEach(el => {
          el.onclick = e => { e.stopPropagation(); handleTrigger(el.getAttribute('data-k')); collapse(); };
        });
      } else {
        fab.classList.remove('aqh-fab-expanded');
        fab.textContent = '王';
      }
    };
    const expand = () => { expanded = true; render(); };
    const collapse = () => { expanded = false; render(); };
    fab.addEventListener('mouseenter', () => { clearTimeout(collapseTimer); expand(); });
    fab.addEventListener('mouseleave', () => { clearTimeout(collapseTimer); collapseTimer = setTimeout(collapse, 350); });
    fab.addEventListener('click', e => { e.stopPropagation(); if (!expanded) { expand(); return; } handleTrigger('auto'); collapse(); });
    return fab;
  }

  function toggleFab() {
    if (window.top !== window) return false;
    const fab = document.getElementById('aqh-fab');
    if (!fab) return false;
    const show = fab.style.display === 'none';
    fab.style.display = show ? '' : 'none';
    return show;
  }

  // ===== 暂停/继续自动答题 =====
  function togglePause() {
    paused = !paused;
    if (autoAnswering) setStatus(paused ? '⏸ 已暂停，点击「暂停/继续」恢复' : '▶ 继续作答…', false);
    return paused;
  }

  async function waitIfPaused() {
    // 仅在自动答题进行中响应暂停；若已被取消/结束则立即放行，避免无限空转
    while (paused && autoAnswering) {
      setStatus('⏸ 已暂停，等待继续…', false);
      await sleep(400);
    }
  }

  // ===== 人工截图接入：粘贴 / 拖拽 / 选文件（禁复制页面的主力路径）=====
  function readImageFile(file) {
    return new Promise(resolve => {
      if (!file || !/^image\//.test(file.type || '')) return resolve(null);
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(file);
    });
  }

  async function handleImageFile(file) {
    const dataUrl = await readImageFile(file);
    if (!dataUrl) { renderBubble('<div class="aqh-err">不是有效的图片文件。</div>', { force: true }); return; }
    await askImage(dataUrl);
  }

  function installManualCapture() {
    // ① 粘贴：任意截图工具截屏后 → 页面 Ctrl+V（捕获阶段监听，先于页面自身处理）
    document.addEventListener('paste', e => {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type && it.type.indexOf('image/') === 0) {
          const f = it.getAsFile();
          if (f) { e.preventDefault(); handleImageFile(f); return; }
        }
      }
    }, true);

    // ② 拖拽图片文件到页面
    document.addEventListener('dragover', e => {
      const t = e.dataTransfer?.types;
      if (t && Array.prototype.indexOf.call(t, 'Files') >= 0) e.preventDefault();
    }, true);
    document.addEventListener('drop', e => {
      const f = e.dataTransfer?.files?.[0];
      if (f && /^image\//.test(f.type || '')) { e.preventDefault(); handleImageFile(f); }
    }, true);
  }

  // 气泡内「上传图片」按钮（选本地图片文件）
  function addUploadButton(containerId) {
    const box = document.getElementById(containerId);
    if (!box) return;
    const wrap = document.createElement('div');
    wrap.style.marginTop = '8px';
    wrap.innerHTML = '<button id="aqh-upload-img" class="aqh-btn-primary">上传图片</button>';
    box.appendChild(wrap);
    const btn = document.getElementById('aqh-upload-img');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) handleImageFile(f);
    });
    box.appendChild(input);
  }

  // ===== 截图兜底作答（禁复制页面 / 图片题）=====
  // 统一走 aqh/ask 通道（与选区共用多服务商并行+增量渲染），不走独立通道
  async function askImage(dataUrl) {
    await askAndShow({ mode: 'image', imageDataUrl: dataUrl, text: '请分析截图中题目并回答。' }, '[screenshot]');
  }

  // 选区为空时的兜底：一键改用截图框选
  function showSelectionFallback() {
    renderBubble(
      '<div class="aqh-err">未选中文本（当前页面可能禁止复制）。</div>' +
      '<div style="margin-top:8px"><button id="aqh-fallback-shot" class="aqh-btn-primary">改用截图框选</button></div>',
      { status: '可用截图兜底', force: true }
    );
    addUploadButton('aqh-body');
    const b = document.getElementById('aqh-fallback-shot');
    if (b) b.addEventListener('click', async () => {
      try {
        const dataUrl = await chooseCropAndCapture();
        await askImage(dataUrl);
      } catch (e) {
        renderBubble('<div class="aqh-err">捕获失败：' + escapeHtml(e?.message || String(e)) + '</div>', { force: true });
      }
    });
  }

  // ===== 气泡显隐（Ctrl+Shift+H / toggle-bubble 命令）=====
  // 文档与 popup 提示均约定为"显示/隐藏气泡"；原实现误切 FAB，按键后常无可见反应
  function toggleBubble() {
    const wrap = document.getElementById('aqh-bubble');
    if (wrap) { closeBubble(); return false; }
    renderBubble(
      '<div style="font-size:13px;line-height:1.9">答题王待命中。<br>' +
      '<span class="muted" style="font-size:11px">Ctrl+Shift+F 自动答题 · Ctrl+Shift+Q 选区 · Ctrl+Shift+E 截图</span></div>',
      { status: '待命', force: true }
    );
    return true;
  }

  async function handleTrigger(kind) {
    if (kind === 'toggle') { toggleBubble(); return; }
    if (kind === 'auto') return autoAnswer();
    // 行内答案徽标显隐：只改 qku-answer-state 属性 + CSS，DOM 保留
    if (kind === 'badge' || kind === 'badge-toggle') {
      if (!window.QuizBadge) return false;
      const visible = QuizBadge.toggleVisible();
      setStatus(visible ? '答案徽标已显示' : '答案徽标已隐藏', false);
      return visible;
    }
    try {
      if (kind === 'selection') {
        const text = getSelectionText();
        if (!text) { showSelectionFallback(); return; }
        await askAndShow({ mode: 'text', text }, text);
      } else if (kind === 'visible') {
        const dataUrl = await chooseCropAndCapture();
        await askAndShow({ mode: 'image', imageDataUrl: dataUrl, text: '请分析截图中题目并回答。' }, '[screenshot]');
      }
    } catch(e) {
      renderBubble('<div class="aqh-err">' + escapeHtml(e?.message||String(e)) + '</div>');
    }
  }

  // ===== 指令路由（chrome.commands 消息与页面级快捷键兜底共用）=====
  // 记录各类指令最近一次由 chrome.commands 到达的时间，供页面兜底热键让位去重
  const lastCmdAt = Object.create(null);

  function routeCapture(kind) {
    // 截图框选 / 召唤气泡只在顶层 frame 执行，避免多 iframe 重复弹遮罩或状态错乱
    if (kind === 'visible' || kind === 'toggle') {
      if (window.top === window) handleTrigger(kind);
      return;
    }
    // 答案显隐：顶层统一切换（含同源 iframe）；跨域 iframe 内的徽标受浏览器限制无法从父页触达
    if (kind === 'badge-toggle') {
      if (window.top !== window) return;
      handleTrigger('badge-toggle');
      return;
    }
    // 自动答题：由顶层 frame 统一编排（同源 iframe 的题目经 targetDoc 提取与点击）。
    // 若此处就在顶层，直接执行；若在 iframe 内，仅当与父页跨域（父页读不到本 frame 的
    // 文档、无法代为作答）时才自行执行——否则会出现顶层 + iframe 各跑一遍，导致面板
    // 重复弹出、选项被重复点击（checkbox 会被点成取消）、LLM 请求翻倍。
    if (kind === 'auto') {
      if (window.top === window) { handleTrigger('auto'); return; }
      let crossOrigin = false;
      try { void window.parent.document; } catch(e) { crossOrigin = true; }
      if (crossOrigin) handleTrigger('auto');
      return;
    }
    // 选区：有选中文本的 frame 直接问；顶层无选中时走"改用截图"兜底 UI
    if (kind === 'selection') {
      if (getSelectionText() || window.top === window) handleTrigger('selection');
      return;
    }
    handleTrigger(kind);
  }

  // ===== 页面级快捷键兜底 =====
  // chrome.commands 注册的快捷键可能被系统/其他扩展占用：一旦冲突，Chrome 会静默丢弃
  // 该命令（页面毫无反应，且不报错）。这里在页面捕获阶段监听同一组合键作为兜底。
  // 去重策略：chrome.commands 正常时，背景消息先到并刷新 lastCmdAt，兜底延时后让位；
  // 命令失效时没有消息到达，兜底照常执行。两条路径不会双触发。
  const PAGE_HOTKEYS = [
    { key: 'q', kind: 'selection' },
    { key: 'e', kind: 'visible' },
    { key: 'f', kind: 'auto' },
    { key: 'h', kind: 'toggle' }
  ];

  function installPageHotkeys() {
    document.addEventListener('keydown', e => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
      const k = String(e.key || '').toLowerCase();
      const code = String(e.code || '');
      const hit = PAGE_HOTKEYS.find(h => h.key === k || code === 'Key' + h.key.toUpperCase());
      if (!hit) return;
      // 输入框 / 编辑区内不拦截，保留正常打字
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      log('页面快捷键兜底触发:', hit.kind);
      // 延时让位：等 chrome.commands 的消息（若命令有效）先到达
      setTimeout(() => {
        if (Date.now() - (lastCmdAt[hit.kind] || 0) < 1000) return;
        routeCapture(hit.kind);
      }, 300);
    }, true);
  }

  // ===== 消息监听 =====
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg?.type) return;
    if (msg.type === 'aqh/capture') {
      const kind = msg.payload?.kind || 'auto';
      lastCmdAt[kind] = Date.now();
      // 检测：只识别题目结构与可作答性，不调 LLM、不点击；结果回传给调用方
      // （popup 状态栏）。只在顶层 frame 执行，与 auto 保持一致的编排归属。
      if (kind === 'detect') {
        if (window.top !== window) return sendResponse({ ok: true });
        detectQuestions()
          .then(r => sendResponse(r))
          .catch(e => sendResponse({ ok: false, error: e?.message || String(e) }));
        return true;
      }
      // 选区：多 frame 竞争。有选中文本的 frame 立即执行并应答 found:true；
      // 顶层 frame 等 150ms（等其他 frame 先应答）仍无选中文本才回复 found:false。
      if (kind === 'selection') {
        if (getSelectionText()) { handleTrigger('selection'); return sendResponse({ ok: true, found: true }); }
        if (window.top === window) { setTimeout(() => sendResponse({ ok: true, found: false }), 150); return true; }
        return sendResponse({ ok: true });
      }
      // 答案显隐：需要把切换后的可见状态回传给 popup
      if (kind === 'badge-toggle') {
        if (window.top !== window) return sendResponse({ ok: true });
        const visible = handleTrigger('badge-toggle');
        return sendResponse({ ok: true, visible: !!visible });
      }
      routeCapture(kind);
      return sendResponse({ ok: true });
    }
    if (msg.type === 'aqh/pause-toggle') {
      const p = togglePause();
      return sendResponse({ ok: true, paused: p });
    }
    if (msg.type === 'aqh/close') { closeBubble(); return sendResponse({ ok: true }); }
    if (msg.type === 'aqh/ping') return sendResponse({ ok: true });
    if (msg.type === 'aqh/show-fab') {
      const shown = toggleFab();
      return sendResponse({ ok: true, shown });
    }

    if (msg.type === 'aqh/ask-item') {
      const p = msg.payload || {};
      if (activeReq && p.reqId === activeReq.reqId && p.item) {
        activeReq.items[p.item.id] = p.item;
        if (activeReq.roster.length > 1) renderProgress();
      }
      return sendResponse({ ok: true });
    }
    if (msg.type === 'aqh/ask-finish') {
      const p = msg.payload || {};
      if (activeReq && p.reqId === activeReq.reqId) {
        const st = activeReq;
        activeReq = null;
        const body = document.getElementById('aqh-body');
        if (body) {
          body.innerHTML = '';
          // 单服务商走 plain layout（参考原版）
          if (st.roster.length <= 1 && p.items?.length === 1) {
            const only = p.items[0];
            if (only.ok) {
              renderSingle(body, only.answer, only.reasoning, only.raw, p.promptMode);
            } else {
              const card = document.createElement('div');
              card.className = 'aqh-item aqh-item-fail';
              card.innerHTML = '<div class="aqh-item-head"><span class="aqh-item-label">' + escapeHtml(only.label) + '</span></div><div class="aqh-err">' + escapeHtml(only.error) + '</div>';
              body.appendChild(card);
            }
          } else {
            renderMulti(body, p.items||[], p.promptMode);
          }
        }
        setStatus('完成。');
      }
      return sendResponse({ ok: true });
    }
  });

  // ===== 初始化 =====
  (async () => {
    cfg = ((await callBg('aqh/get-config')) || {}).cfg || null;
    if (cfg?.promptMode) promptMode = cfg.promptMode;
    // 行内答案徽标开关同步（关闭时清掉本扩展已注入的徽标）
    if (window.QuizBadge) QuizBadge.configure(cfg);
    // 视觉特效开关同步（关闭时清掉高亮/虚拟光标/消息面板等已注入特效）
    if (window.QuizHighlight) QuizHighlight.configure({ fxEnabled: cfg?.visualFx !== false });
    ensureFab();
    installManualCapture(); // 粘贴 / 拖拽 / 上传图片
    installPageHotkeys(); // 页面级快捷键兜底（chrome.commands 被冲突占用时接棒）
    log('booted, providers:', (cfg?.providers||[]).filter(p=>p.hasKey).length, 'hasKey:', cfg?.hasKey, 'inlineBadge:', !!cfg?.inlineBadge, 'visualFx:', cfg?.visualFx !== false);
  })();
})();