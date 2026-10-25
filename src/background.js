/**
 * QuizKing Ultimate — background.js
 * service worker：命令路由 / LLM 并行请求 / 存储 / 自动答题编排
 */
const DEFAULTS = {
  temperature: 0.1,
  bubbleOpacity: 0.95,
  systemPrompt: '你是一个严谨的解题助手。输出严格JSON：{"answer":"答案","reasoning":"解析"}。只输出JSON，不要其他文字。',
  promptMode: 'reason',
  saveHistory: true,
  autoSubmit: false,
  autoDelay: 300,
  autoBatch: 5,
  silentMode: false,
  inlineBadge: false,
  visualFx: true
};

// ===== 配置管理 =====
// LLM 服务商统一在选项页手动填写（providers[]），此处不再内置任何默认密钥。
// 开发调试时可在下方 LLM_DEFAULTS 临时填入测试密钥，提交前务必清空。
const LLM_DEFAULTS = {
  endpoint: '', // 例如: 'https://api.openai.com/v1'
  model: '',    // 例如: 'gpt-4o-mini'
  apiKey: ''    // 例如: 'sk-...'
};

// 需要从下发给 content/popup 的配置中剔除的敏感/内部键
const PRIVATE_CFG_KEYS = ['llmEndpoint', 'llmModel', 'llmApiKey'];

async function ensureDefaults() {
  return new Promise(resolve => {
    chrome.storage.sync.get(Object.keys(DEFAULTS).concat(['providers']), cur => {
      const patch = {};
      for (const k of Object.keys(DEFAULTS)) {
        if (cur[k] === undefined) patch[k] = DEFAULTS[k];
      }

      const providers = Array.isArray(cur.providers) ? cur.providers : [];
      if (!providers.length && LLM_DEFAULTS.endpoint && LLM_DEFAULTS.model) {
        // 仅当开发者临时填入 LLM_DEFAULTS 时才创建默认 provider
        providers.push({
          id: 'p1',
          label: '默认',
          endpoint: LLM_DEFAULTS.endpoint,
          apiKey: LLM_DEFAULTS.apiKey || '',
          model: LLM_DEFAULTS.model,
          enabled: true
        });
        patch.providers = providers;
      }

      if (Object.keys(patch).length) chrome.storage.sync.set(patch);
      resolve({ ...DEFAULTS, ...cur, ...patch, providers });
    });
  });
}

// 生成对外安全的配置副本：剔除 apiKey 与内部 llm* 键
function publicConfig(cfg) {
  const safe = { ...cfg };
  PRIVATE_CFG_KEYS.forEach(k => { delete safe[k]; });
  safe.providers = cfg.providers.map(({ apiKey, ...p }) => ({ ...p, hasKey: !!apiKey }));
  safe.hasKey = safe.providers.some(p => p.enabled && p.hasKey);
  return safe;
}

function activeProviders(cfg) {
  return (cfg.providers || []).filter(p => p.enabled && p.apiKey);
}

// ===== LLM 调用（单 provider） =====
// opts: { systemPrompt: 覆盖系统提示词, raw: 跳过 JSON 解析直接返回原文 }
async function callProvider(provider, payload, cfg, opts) {
  opts = opts || {};
  const url = (provider.endpoint || '').replace(/\/$/, '') + '/chat/completions';
  const userContent = [{ type: 'text', text: payload.text }];
  if (payload.imageDataUrl) {
    userContent.push({ type: 'image_url', image_url: { url: payload.imageDataUrl } });
  }

  const body = {
    model: provider.model,
    temperature: Number(cfg.temperature ?? DEFAULTS.temperature),
    messages: [
      { role: 'system', content: opts.systemPrompt || cfg.systemPrompt || DEFAULTS.systemPrompt },
      { role: 'user', content: userContent }
    ]
  };

  const ctrl = new AbortController();
  const timeoutMs = opts.timeoutMs || 45000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + provider.apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error('HTTP ' + res.status + ' ' + (txt || '').slice(0, 120));
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? '';
    if (opts.raw) return { answer: String(raw).trim(), reasoning: '', raw };
    return parseAnswer(raw);
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('超时（' + Math.round(timeoutMs / 1000) + 's 无响应）');
    if (/failed to fetch|networkerror|err_/i.test(e?.message || '')) {
      throw new Error('无法连接 API 端点（网络/代理中断或网关临时不可用）');
    }
    throw e;
  } finally { clearTimeout(timer); }
}

function parseAnswer(raw) {
  let text = (raw || '').trim();
  // 去掉 think/scratchpad 标签
  text = text.replace(/<\/?[\w\u4e00-\u9fa5]+>/g, ' ').replace(/\s+\n/g, '\n').trim();
  // 提取第一个 JSON 对象
  const jsonSlice = text.match(/\{[^{}]*?"answer"\s*:\s*"[\s\S]*?"\s*[^{}]*?\}/);
  if (jsonSlice) text = jsonSlice[0];

  let answer = '', reasoning = '';
  try {
    const obj = JSON.parse(text);
    answer = (obj.answer ?? '').toString().trim();
    reasoning = (obj.reasoning ?? '').toString().trim();
  } catch {
    reasoning = text;
    answer = text.split(/\r?\n/)[0].trim();
  }
  return { answer, reasoning, raw };
}

// ===== 并行扇出 =====
async function askAll(payload, onItem) {
  const cfg = await ensureDefaults();
  const active = activeProviders(cfg);
  if (!active.length) throw new Error('未配置LLM，请在选项页添加服务商');

  const items = new Array(active.length);
  await Promise.all(active.map(async (p, i) => {
    let item;
    try {
      const t0 = Date.now();
      const r = await callProvider(p, payload, cfg);
      item = { id: p.id, label: p.label, model: p.model, ok: true, answer: r.answer, reasoning: r.reasoning, raw: r.raw, ms: Date.now() - t0 };
    } catch (e) {
      item = { id: p.id, label: p.label, model: p.model, ok: false, error: (e?.message) || String(e), ms: null };
    }
    items[i] = item;
    if (onItem) { try { onItem(item); } catch(e) { void e; } }
  }));
  return items;
}

// ===== 答案一致性 =====
function normAnswer(s) { return String(s||'').trim().toUpperCase().replace(/\s+/g, ''); }

// 把 "A,C" / "AC" 解析为去重后的选项下标数组（重复字母会导致重复点击=取消已选，必须去重）
function lettersToIndices(clean, optionCount) {
  const letters = String(clean || '').includes(',') ? String(clean).split(',') : String(clean || '').split('');
  const seen = new Set();
  const idxs = [];
  letters.forEach(c => {
    const i = c.charCodeAt(0) - 65;
    if (i >= 0 && i < (optionCount || 0) && !seen.has(i)) { seen.add(i); idxs.push(i); }
  });
  return idxs;
}

// 单选题：把模型答案解析为选项下标。优先字母，退化为按选项文本匹配
// （模型经常不守格式、直接返回选项内容）。解析不出返回 -1。
function resolveSingleIndex(answerText, options) {
  const clean = String(answerText || '').trim().toUpperCase().replace(/[^A-E,]/g, '');
  const letters = clean.includes(',') ? clean.split(',') : clean.split('');
  for (const c of letters) {
    const i = c.charCodeAt(0) - 65;
    if (i >= 0 && i < (options?.length || 0)) return i;
  }
  // 退化：按选项文本匹配
  const ans = String(answerText || '').trim().toLowerCase();
  if (ans && options?.length) {
    const hit = options.findIndex(o => {
      const t = String(o.text || '').trim().toLowerCase();
      return !!t && (t === ans || ans.includes(t) || t.includes(ans));
    });
    if (hit >= 0) return hit;
  }
  return -1;
}

function bgLog(...a) { try { console.log('[qku-bg]', ...a); } catch(e) {} }

function getBestAnswer(items) {
  const okItems = items.filter(it => it.ok);
  if (!okItems.length) return null;
  // 多数投票
  const counts = {};
  okItems.forEach(it => { const n = normAnswer(it.answer); counts[n] = (counts[n]||0) + 1; });
  let best = '', max = 0;
  Object.keys(counts).forEach(k => { if (counts[k] > max) { max = counts[k]; best = k; } });
  // 返回对应的完整结果
  return okItems.find(it => normAnswer(it.answer) === best) || okItems[0];
}

// ===== 历史记录（最近 200 条，写入 chrome.storage.local）=====
// 整批一次读写，避免并行多路写入互相覆盖；尊重 saveHistory 开关。
// 使用写锁队列化，防止并发竞态条件。
let _historyWriteLock = Promise.resolve();

async function saveHistoryMany(entries) {
  if (!entries || !entries.length) return;
  const cfg = await ensureDefaults();
  if (!cfg.saveHistory) return;
  
  // 串行化写入操作
  _historyWriteLock = _historyWriteLock.then(() => 
    new Promise((resolve) => {
      chrome.storage.local.get({ history: [] }, (cur) => {
        const list = [...entries, ...((cur && cur.history) || [])].slice(0, 200);
        chrome.storage.local.set({ history: list }, () => resolve());
      });
    })
  );
  return _historyWriteLock;
}

// ===== Tab 通信 =====
function pushToTab(tabId, type, payload) {
  if (tabId === undefined || tabId === null) return;
  try {
    chrome.tabs.sendMessage(tabId, { type, payload }, () => { void chrome.runtime.lastError; });
  } catch(e) { void e; }
}

async function getActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs?.[0]));
  });
}

// ===== 状态缓存（静默模式下 popup 显示用） =====
let lastStatus = { text: '就绪', loading: false };

// ===== 消息路由 =====
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg?.type) return sendResponse({ ok: false });

      // 配置查询（已剔除 apiKey 与内部 llm* 键，不下发给页面）
      if (msg.type === 'aqh/get-config') {
        const cfg = await ensureDefaults();
        return sendResponse({ ok: true, cfg: publicConfig(cfg) });
      }

      // 探活 / 状态查询（popup 用）
      if (msg.type === 'aqh/test') {
        const cfg = await ensureDefaults();
        const safe = cfg.providers.map(({ apiKey, ...p }) => ({ ...p, hasKey: !!apiKey }));
        return sendResponse({
          ok: true,
          cfg: safe,
          hasKey: safe.some(p => p.enabled && p.hasKey),
          providerCount: safe.filter(p => p.enabled).length,
          silentMode: !!cfg.silentMode,
          status: lastStatus
        });
      }

      // 状态更新（content.js 静默模式下推送）
      if (msg.type === 'aqh/status-update') {
        lastStatus = msg.payload || { text: '就绪', loading: false };
        return sendResponse({ ok: true });
      }

      // 截图
      if (msg.type === 'aqh/capture-visible-tab') {
        const tab = sender.tab || (await getActiveTab());
        return new Promise(resolve => {
          chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, dataUrl => {
            if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
            resolve({ ok: true, dataUrl });
          });
        }).then(sendResponse);
      }

      // 单次问答（原 QuizKing 通道）
      if (msg.type === 'aqh/ask') {
        const payload = msg.payload || {};
        const tabId = sender.tab?.id;
        const cfg = await ensureDefaults();
        const active = activeProviders(cfg);
        if (!active.length) {
          return sendResponse({ ok: false, error: '未配置LLM' });
        }
        const reqId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        sendResponse({ ok: true, result: { reqId, pending: active.map(p => ({ id: p.id, label: p.label, model: p.model })), promptMode: cfg.promptMode } });

        // 异步扇出
        askAll(payload, item => pushToTab(tabId, 'aqh/ask-item', { reqId, item }))
          .then(items => {
            pushToTab(tabId, 'aqh/ask-finish', { reqId, items, promptMode: cfg.promptMode });
            saveHistoryMany(
              items.filter(it => it.ok).map(it => ({
                ts: Date.now(),
                mode: payload.mode || 'text',
                question: (payload.text || '(图片)').slice(0, 2000),
                provider: it.label,
                answer: it.answer,
                reasoning: it.reasoning,
                model: it.model
              }))
            );
          })
          .catch(() => {});
        return true;
      }

      // ===== 自动答题：逐题推理+返回答案 =====
      if (msg.type === 'aqh/auto-answer') {
        const question = msg.payload;
        const active = activeProviders(await ensureDefaults());
        if (!active.length) return sendResponse({ ok: false, error: '未配置LLM' });

        const isMulti = question.type === 'multi_choice';
        let prompt = question.stem + '\n';
        if (question.options?.length) {
          prompt += '\n选项:\n';
          question.options.forEach((o, i) => prompt += String.fromCharCode(65 + i) + '. ' + o.text + '\n');
          prompt += isMulti
            ? '\n这是多选题。请输出所有正确选项字母（如 AB 或 A,B），JSON：{"answer":"A,C","reasoning":"简析"}'
            : '\n请只输出答案选项字母（如 A），严格JSON格式：{"answer":"A","reasoning":"简析"}';
        }

        const items = await askAll({ mode: 'text', text: prompt });
        const best = getBestAnswer(items);
        if (!best) return sendResponse({ ok: false, error: '推理失败' });

        // 解析答案
        const answerClean = best.answer.trim().toUpperCase().replace(/[^A-E,]/g, '');
        if (isMulti) {
          const optionIndices = lettersToIndices(answerClean, question.options?.length || 0);
          sendResponse({ ok: true, answer: best.answer, reasoning: best.reasoning, optionIndices, isMulti: true, items });
        } else {
          const optionIndex = resolveSingleIndex(best.answer, question.options);
          if (optionIndex < 0) {
            return sendResponse({ ok: false, error: '答案无法解析为选项：' + JSON.stringify(best.answer).slice(0, 80) });
          }
          sendResponse({ ok: true, answer: best.answer, reasoning: best.reasoning, optionIndex, isMulti: false, items });
        }
        return true;
      }

      // 批量自动答题——返回所有答案
      if (msg.type === 'aqh/auto-answer-batch') {
        const questions = msg.payload.questions || [];
        const active = activeProviders(await ensureDefaults());
        bgLog('auto-answer-batch: 收到', questions.length, '题；可用服务商', active.length,
              active.map(p => p.id + ':' + p.model).join(',') || '(无)');
        if (!active.length) {
          bgLog('auto-answer-batch: 无可用服务商，直接失败');
          return sendResponse({ ok: false, error: '未配置LLM：请在选项页添加服务商并填写 API Key' });
        }

        // 批量并行推理
        const answers = await Promise.all(questions.map(async q => {
          const isMulti = q.type === 'multi_choice';
          let prompt = q.stem + '\n';
          if (q.options?.length) {
            prompt += '\n选项:\n';
            q.options.forEach((o, i) => { prompt += String.fromCharCode(65 + i) + '. ' + o.text + '\n'; });
            prompt += isMulti
              ? '\n这是多选题。输出所有正确选项字母（如 A,C），严格JSON：{"answer":"A,C","reasoning":"简析"}'
              : '\n只输出选项字母（如 A），严格JSON：{"answer":"A","reasoning":"简析"}';
          }
          try {
            const items = await askAll({ mode: 'text', text: prompt });
            const best = getBestAnswer(items);
            bgLog('题', q.index, '服务商返回:', items.map(it => it.ok ? ('OK(' + (it.ms||0) + 'ms)') : ('FAIL:' + it.error)).join(' | '));
            if (best) {
              bgLog('题', q.index, '最佳答案:', JSON.stringify(best.answer).slice(0, 120));
              if (isMulti) {
                // "A,C" or "AC" → both should work（已去重）
                const idxs = lettersToIndices(best.answer.trim().toUpperCase().replace(/[^A-E,]/g, ''), q.options?.length || 0);
                bgLog('题', q.index, '多选下标:', JSON.stringify(idxs));
                return { index: q.index, answer: best.answer, reasoning: best.reasoning, optionIndices: idxs, isMulti: true, ok: true };
              }
              const idx = resolveSingleIndex(best.answer, q.options);
              if (idx < 0) {
                bgLog('题', q.index, '!! 无法解析出选项下标，原始答案:', JSON.stringify(best.answer).slice(0, 200));
                return { index: q.index, answer: best.answer, reasoning: best.reasoning, optionIndex: -1, isMulti: false, ok: false,
                         error: '答案无法解析为选项（模型未按格式返回字母）：' + JSON.stringify(best.answer).slice(0, 80) };
              }
              bgLog('题', q.index, '单选下标:', idx);
              return { index: q.index, answer: best.answer, reasoning: best.reasoning, optionIndex: idx, isMulti: false, ok: true };
            }
            bgLog('题', q.index, '!! 无可用答案（所有服务商均失败）');
            return { index: q.index, answer: '', reasoning: '', optionIndex: -1, ok: false, error: '所有服务商推理失败' };
          } catch(e) {
            bgLog('题', q.index, '!! 推理异常:', e?.message || String(e));
            return { index: q.index, answer: '', reasoning: '', optionIndex: -1, ok: false, error: e?.message || String(e) };
          }
        }));
        bgLog('auto-answer-batch: 返回', answers.filter(a => a.ok).length + '/' + answers.length, '题成功');
        sendResponse({ ok: true, answers });
        return true;
      }

      return sendResponse({ ok: false, error: 'unknown' });
    } catch(e) {
      return sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true;
});

// ===== 快捷键 & 右键 =====
const MENU_IDS = { selection: 'aqh-selection', visible: 'aqh-visible', auto: 'aqh-auto', close: 'aqh-close' };

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_IDS.selection, title: '抓取选区问AI', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_IDS.visible, title: '截图框选问AI', contexts: ['page'] });
    chrome.contextMenus.create({ id: MENU_IDS.auto, title: '🚀 自动检测并作答（不交卷）', contexts: ['page'] });
    chrome.contextMenus.create({ id: MENU_IDS.close, title: '关闭气泡', contexts: ['page'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_IDS.close) return pushToTab(tab?.id, 'aqh/close', {});
  const kind = info.menuItemId === MENU_IDS.selection ? 'selection' : info.menuItemId === MENU_IDS.auto ? 'auto' : 'visible';
  pushToTab(tab?.id, 'aqh/capture', { kind });
});

chrome.commands.onCommand.addListener(async cmd => {
  // 诊断日志：快捷键无反应时，到 chrome://extensions → 本扩展「Service Worker 检查视图」
  // 看是否有此行；没有说明命令根本没到达扩展（快捷键被系统/其他扩展占用），
  // 此时页面级兜底监听会接棒；有此行但页面没反应则是 content 链路问题。
  bgLog('commands.onCommand:', cmd);
  if (cmd === 'auto-answer') {
    const tab = await getActiveTab();
    pushToTab(tab?.id, 'aqh/capture', { kind: 'auto' });
  }
  if (cmd === 'capture-selection') {
    const tab = await getActiveTab();
    pushToTab(tab?.id, 'aqh/capture', { kind: 'selection' });
  }
  if (cmd === 'capture-visible') {
    const tab = await getActiveTab();
    pushToTab(tab?.id, 'aqh/capture', { kind: 'visible' });
  }
  if (cmd === 'toggle-bubble') {
    const tab = await getActiveTab();
    pushToTab(tab?.id, 'aqh/capture', { kind: 'toggle' });
  }
});