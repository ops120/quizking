/**
 * QuizKing · 答题王 — background service worker.
 * @license MIT
 *
 * Responsibilities:
 *   * Register context menu items.
 *   * Route commands from popup / content / commands / context menu.
 *   * Hold API config in chrome.storage.sync; never expose API key to content scripts.
 *   * Call OpenAI-compatible /chat/completions and stream / answer back.
 */
const MENU_IDS = {
  selection: "aqh-capture-selection",
  visible: "aqh-capture-visible",
  page: "aqh-capture-page",
  close: "aqh-close-bubble",
};

// Per-provider fallbacks. The user manages a list of these in options.html.
const PROVIDER_DEFAULTS = {
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

// Legacy keys (endpoint / apiKey / model) are read once for migration only.
const LEGACY_KEYS = ["endpoint", "apiKey", "model"];

const DEFAULTS = {
  temperature: 0.2,
  bubbleOpacity: 0.95,
  systemPrompt:
    "你是一位严谨的解题助手。用户会给你网页上截取的一道题目（可能附文本和图片）。请仔细阅读，输出严格的 JSON：{\"answer\":\"...\", \"reasoning\":\"...\"}，不要任何额外文字、不要 markdown 代码块。answer 用最简洁的方式给出最终答案；reasoning 解释关键步骤（中文）。",
  promptMode: "reason",
  reasoningPrompt:
    "你是一位严谨的解题助手。用户会给你网页上截取的一道题目（可能附文本和图片）。请仔细阅读，输出严格的 JSON：{\"answer\":\"...\", \"reasoning\":\"...\"}，不要任何额外文字、不要 markdown 代码块。answer 用最简洁的方式给出最终答案；reasoning 解释关键步骤（中文）。",
  saveHistory: true,
};

function normalizeProvider(p, i) {
  const src = p || {};
  const label = String(src.label || "").trim();
  const endpoint = String(src.endpoint || "").trim();
  const model = String(src.model || "").trim();
  return {
    id: String(src.id || ("p" + (i + 1))),
    label: label || ("服务商 " + (i + 1)),
    endpoint: endpoint || PROVIDER_DEFAULTS.endpoint,
    apiKey: String(src.apiKey || ""),
    model: model || PROVIDER_DEFAULTS.model,
    enabled: src.enabled !== false,
  };
}

function ensureDefaults() {
  return new Promise((resolve) => {
    const keys = Object.keys(DEFAULTS).concat(["providers"], LEGACY_KEYS);
    chrome.storage.sync.get(keys, (cur) => {
      const patch = {};
      for (const k of Object.keys(DEFAULTS)) {
        // Migrate stale "answer" mode to "reason" so the answer-only path is gone.
        if (k === "promptMode" && cur.promptMode === "answer") {
          patch.promptMode = "reason";
          continue;
        }
        if (cur[k] === undefined) patch[k] = DEFAULTS[k];
      }
      let providers;
      if (Array.isArray(cur.providers)) {
        providers = cur.providers.map(normalizeProvider);
      } else {
        // One-time migration from the single-endpoint layout.
        const hasLegacy = LEGACY_KEYS.some((k) => cur[k]);
        providers = hasLegacy
          ? [normalizeProvider({ id: "p1", label: "默认", endpoint: cur.endpoint, apiKey: cur.apiKey, model: cur.model }, 0)]
          : [];
        patch.providers = providers;
      }
      if (Object.keys(patch).length) chrome.storage.sync.set(patch);
      resolve({ ...DEFAULTS, ...cur, ...patch, providers });
    });
  });
}

function activeProviders(cfg) {
  return (cfg.providers || []).filter((p) => p.enabled && p.apiKey);
}

function pickSystemPrompt(cfg) {
  // Modes:
  //   "reason" — answer + reasoning (default).
  //   "custom" — user-typed systemPrompt verbatim.
  const mode = cfg.promptMode || "reason";
  if (mode === "custom") return cfg.systemPrompt || DEFAULTS.systemPrompt;
  return cfg.reasoningPrompt || DEFAULTS.reasoningPrompt;
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0]);
    });
  });
}

async function sendToContent(tab, type, payload) {
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type, payload });
  } catch (e) {
    // ignore if no content script (e.g. chrome:// pages)
    console.warn("sendToContent failed", type, e && e.message);
  }
}

async function triggerCapture(kind) {
  const tab = await getActiveTab();
  if (!tab) return;
  await sendToContent(tab, "aqh/capture", { kind });
}

async function captureVisibleToBase64(tab) {
  // chrome 旗舰 API：直接拿可见窗口快照（PNG）。
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(dataUrl);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// A hung endpoint would otherwise leave the bubble waiting forever.
const REQUEST_TIMEOUT_MS = 45000;

function timeoutError() {
  return new Error("超时（" + Math.round(REQUEST_TIMEOUT_MS / 1000) + "s 无响应）");
}

async function callProvider(provider, payload, cfg) {
  const url = (provider.endpoint || PROVIDER_DEFAULTS.endpoint).replace(/\/$/, "") + "/chat/completions";
  const userContent = [];
  if (payload.text) userContent.push({ type: "text", text: payload.text });
  if (payload.imageDataUrl) {
    userContent.push({
      type: "image_url",
      image_url: { url: payload.imageDataUrl },
    });
  }
  const body = {
    model: provider.model || PROVIDER_DEFAULTS.model,
    temperature: Number(cfg.temperature ?? DEFAULTS.temperature),
    messages: [
      { role: "system", content: pickSystemPrompt(cfg) },
      { role: "user", content: userContent.length ? userContent : [{ type: "text", text: "" }] },
    ],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + provider.apiKey,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + " " + (txt || "").slice(0, 120));
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    return parseAnswer(raw);
  } catch (e) {
    if (e && e.name === "AbortError") throw timeoutError();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function askAll(payload, onItem) {
  // Fan out to every enabled provider in parallel; each result is reported the
  // moment it lands so the bubble can fill in progressively. One failure never
  // blocks the rest.
  const cfg = await ensureDefaults();
  const active = activeProviders(cfg);
  if (!active.length) {
    throw new Error(
      (cfg.providers || []).length
        ? "没有已启用且填了 API Key 的服务商，请在选项页检查。"
        : "未配置任何服务商，请先在选项页添加。"
    );
  }
  const items = new Array(active.length);
  await Promise.all(
    active.map(async (p, i) => {
      let item;
      try {
        const t0 = Date.now();
        const r = await callProvider(p, payload, cfg);
        item = {
          id: p.id,
          label: p.label,
          model: p.model,
          ok: true,
          answer: r.answer,
          reasoning: r.reasoning,
          raw: r.raw,
          ms: Date.now() - t0,
        };
      } catch (e) {
        item = {
          id: p.id,
          label: p.label,
          model: p.model,
          ok: false,
          error: (e && e.message) || String(e),
          ms: null,
        };
      }
      items[i] = item;
      if (onItem) { try { onItem(item); } catch (e) { void e; } }
    })
  );
  return { cfg, active, items };
}

function parseAnswer(raw) {
  // If broken, restore the old regex:
  //   /\{[^{}]*"answer"[^{}]*"reasoning"[\s\S]*?\}/

  let answer = "";
  let reasoning = "";
  let text = (raw || "").trim();

  // 1) remove ︎...︎ and any <tag>...</tag> traces (ml models often leak their scratchpad)
  text = text.replace(/<\/?[\w\u4e00-\u9fa5]+>/g, " ").replace(/\s+\n/g, "\n").trim();

  // 1b) Harvest the first {"answer": ...}-style object out of the blob.
  //     Works for both answer-only mode and answer+reasoning mode, even when the model wraps it in prose or a ︎ block.
  //     The object is non-nested (no curly braces inside string values), so the [^{}] restriction is safe.
  const jsonSlice = text.match(/\{[^{}]*?"answer"\s*:\s*"[\s\S]*?"\s*[^{}]*?\}/);
  if (jsonSlice) text = jsonSlice[0];
  try { console.log("[aqh-bg] parseAnswer raw len=", (raw||"").length, "slice?", !!jsonSlice); } catch {}
  try {
    const obj = JSON.parse(text);
    answer = (obj.answer ?? "").toString().trim();
    reasoning = (obj.reasoning ?? "").toString().trim();
  } catch {
    // fallback: whole text becomes reasoning, first line is answer
    reasoning = text;
    answer = text.split(/\r?\n/)[0].trim();
  }

  // 4) if 'answer' still looks like a JSON value or has braces, strip surrounding quotes
  if (answer.startsWith('"') && answer.endsWith('"')) {
    try { answer = JSON.parse(answer); } catch {}
  }

  return { answer, reasoning, raw };
}

function newReqId() {
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function pushToTab(tabId, type, payload) {
  if (tabId === undefined || tabId === null) return;
  try {
    // Callback form so a closed tab surfaces as lastError instead of a throw.
    chrome.tabs.sendMessage(tabId, { type, payload }, () => { void chrome.runtime.lastError; });
  } catch (e) { void e; }
}

async function runAsk({ reqId, tabId, payload, cfg, active, promptMode }) {
  let items;
  try {
    const settled = await askAll(payload, (item) => {
      pushToTab(tabId, "aqh/ask-item", { reqId, item });
    });
    items = settled.items;
  } catch (e) {
    const msg = (e && e.message) || String(e);
    items = active.map((p) => ({ id: p.id, label: p.label, model: p.model, ok: false, error: msg, ms: null }));
  }
  pushToTab(tabId, "aqh/ask-finish", { reqId, items, promptMode });
  await saveHistoryMany(
    items.filter((it) => it.ok).map((it) => ({
      ts: Date.now(),
      mode: payload.mode || "text",
      question: payload.text || "(image)",
      provider: it.label,
      answer: it.answer,
      reasoning: it.reasoning,
      model: it.model,
    }))
  );
}

async function saveHistoryMany(entries) {
  // One read + one write for the whole batch: parallel single writes would clobber each other.
  if (!entries.length) return;
  const cfg = await ensureDefaults();
  if (!cfg.saveHistory) return;
  return new Promise((resolve) => {
    chrome.storage.local.get({ history: [] }, (cur) => {
      const list = [...entries, ...(cur.history || [])].slice(0, 200);
      chrome.storage.local.set({ history: list }, () => resolve());
    });
  });
}


// --- Wiring ---------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  // 注册右键菜单
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_IDS.selection,
      title: "抓取选区并问 AI",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.visible,
      title: "抓取可见区域并问 AI",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.page,
      title: "抓取整页 DOM 文本并问 AI",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: MENU_IDS.close,
      title: "关闭当前 AI 气泡",
      contexts: ["page"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_IDS.selection) return triggerCapture("selection");
  if (info.menuItemId === MENU_IDS.visible) return triggerCapture("visible");
  if (info.menuItemId === MENU_IDS.page) return triggerCapture("page");
  if (info.menuItemId === MENU_IDS.close) return sendToContent(tab, "aqh/close", {});
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "capture-selection") return triggerCapture("selection");
  if (cmd === "capture-visible") return triggerCapture("visible");
  if (cmd === "capture-page") return triggerCapture("page");
  if (cmd === "toggle-bubble") return triggerCapture("toggle");
});

// 来自 content 的消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || !msg.type) return sendResponse({ ok: false, error: "empty" });
      if (msg.type === "aqh/get-config") {
        const cfg = await ensureDefaults();
        return sendResponse({ ok: true, cfg: sanitizeCfg(cfg) });
      }
      if (msg.type === "aqh/capture-visible-tab") {
        const tab = sender.tab || (await getActiveTab());
        const dataUrl = await captureVisibleToBase64(tab);
        return sendResponse({ ok: true, dataUrl });
      }
      if (msg.type === "aqh/ask") {
        const payload = msg.payload || {};
        const tabId = sender.tab && sender.tab.id;
        const cfg = await ensureDefaults();
        const active = activeProviders(cfg);
        if (!active.length) {
          return sendResponse({
            ok: false,
            error: (cfg.providers || []).length
              ? "没有已启用且填了 API Key 的服务商，请在选项页检查。"
              : "未配置任何服务商，请先在选项页添加。",
          });
        }
        const reqId = newReqId();
        const promptMode = cfg.promptMode || "reason";
        // Reply right away with the roster so the bubble can draw one pending
        // card per provider, then stream each answer in as it arrives.
        sendResponse({
          ok: true,
          result: { reqId, pending: active.map((p) => ({ id: p.id, label: p.label, model: p.model })), promptMode },
        });
        runAsk({ reqId, tabId, payload, cfg, active, promptMode });
        return true;
      }
      if (msg.type === "aqh/selftest" && self.__AQH_SELFTEST__) {
        const cfg = await ensureDefaults();
        return sendResponse({
          ok: true,
          cfg: sanitizeCfg(cfg),
          routes: ["aqh/get-config", "aqh/capture-visible-tab", "aqh/ask", "aqh/test", "aqh/selftest"],
          flags: { selftest: !!self.__AQH_SELFTEST__ },
        });
      }
      if (msg.type === "aqh/test") {
        const cfg = await ensureDefaults();
        const safe = sanitizeCfg(cfg);
        return sendResponse({
          ok: true,
          cfg: safe,
          hasKey: safe.hasKey,
          providerCount: safe.providers.filter((p) => p.enabled).length,
        });
      }
      return sendResponse({ ok: false, error: "unknown" });
    } catch (e) {
      return sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true; // 异步响应
});

function sanitizeCfg(cfg) {
  // content 不需要 apiKey：逐条剥离，并把旧的单服务商字段整体剔除。
  const { apiKey, endpoint, model, providers, ...rest } = cfg;
  const safeProviders = (providers || []).map(({ apiKey: key, ...p }) => ({ ...p, hasKey: !!key }));
  return {
    ...rest,
    providers: safeProviders,
    hasKey: safeProviders.some((p) => p.enabled && p.hasKey),
  };
}
