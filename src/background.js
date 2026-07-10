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

const DEFAULTS = {
  endpoint: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.2,
  bubbleOpacity: 0.95,
  systemPrompt:
    "你是一位严谨的解题助手。用户会给你网页上截取的一道题目（可能附文本和图片）。请仔细阅读，输出严格的 JSON：{\"answer\":\"...\", \"reasoning\":\"...\"}，不要任何额外文字、不要 markdown 代码块。answer 用最简洁的方式给出最终答案；reasoning 解释关键步骤（中文）。",
  promptMode: "reason",
  reasoningPrompt:
    "你是一位严谨的解题助手。用户会给你网页上截取的一道题目（可能附文本和图片）。请仔细阅读，输出严格的 JSON：{\"answer\":\"...\", \"reasoning\":\"...\"}，不要任何额外文字、不要 markdown 代码块。answer 用最简洁的方式给出最终答案；reasoning 解释关键步骤（中文）。",
  saveHistory: true,
};

function ensureDefaults() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(Object.keys(DEFAULTS), (cur) => {
      const patch = {};
      for (const k of Object.keys(DEFAULTS)) {
        // Migrate stale "answer" mode to "reason" so the answer-only path is gone.
        if (k === "promptMode" && cur.promptMode === "answer") {
          patch.promptMode = "reason";
          continue;
        }
        if (cur[k] === undefined) patch[k] = DEFAULTS[k];
      }
      if (Object.keys(patch).length) chrome.storage.sync.set(patch);
      resolve({ ...DEFAULTS, ...cur, ...patch });
    });
  });
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

async function askLLM(payload) {
  // payload = { mode: 'image'|'text', text?: string, imageDataUrl?: string }
  const cfg = await ensureDefaults();
  if (!cfg.apiKey) {
    throw new Error("未配置 API Key，请先在选项页填写。");
  }
  const url = (cfg.endpoint || DEFAULTS.endpoint).replace(/\/$/, "") + "/chat/completions";
  const userContent = [];
  if (payload.text) userContent.push({ type: "text", text: payload.text });
  if (payload.imageDataUrl) {
    userContent.push({
      type: "image_url",
      image_url: { url: payload.imageDataUrl },
    });
  }
  const body = {
    model: cfg.model || DEFAULTS.model,
    temperature: Number(cfg.temperature ?? DEFAULTS.temperature),
    messages: [
      { role: "system", content: pickSystemPrompt(cfg) },
      { role: "user", content: userContent.length ? userContent : [{ type: "text", text: "" }] },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + cfg.apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error("LLM HTTP " + res.status + " " + (txt || "").slice(0, 200));
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? "";
  return parseAnswer(raw);
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

async function saveHistory(entry) {
  const cfg = await ensureDefaults();
  if (!cfg.saveHistory) return;
  return new Promise((resolve) => {
    chrome.storage.local.get({ history: [] }, (cur) => {
      const list = [entry, ...(cur.history || [])].slice(0, 200);
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
        const cfg = await ensureDefaults();
        const result = await askLLM(msg.payload || {});
        await saveHistory({
          ts: Date.now(),
          mode: msg.payload?.mode || "text",
          question: msg.payload?.text || "(image)",
          answer: result.answer,
          reasoning: result.reasoning,
          model: cfg.model,
        });
        return sendResponse({ ok: true, result: { ...result, promptMode: cfg.promptMode || "answer" } });
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
        return sendResponse({ ok: true, cfg: sanitizeCfg(cfg), hasKey: !!cfg.apiKey });
      }
      return sendResponse({ ok: false, error: "unknown" });
    } catch (e) {
      return sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true; // 异步响应
});

function sanitizeCfg(cfg) {
  // content 不需要 apiKey，回传时去掉
  const { apiKey, ...rest } = cfg;
  return { ...rest, hasKey: !!apiKey };
}
