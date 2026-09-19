/** @license MIT — QuizKing · 答题王 options page. */
const FIELDS = [
  "providers",
  "temperature",
  "systemPrompt",
  "promptMode",
  "reasoningPrompt",
  "bubbleOpacity",
  "saveHistory",
];

// Legacy single-endpoint keys, read once to seed the provider list.
const LEGACY_KEYS = ["endpoint", "apiKey", "model"];

const PROVIDER_DEFAULTS = {
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

const REASONING_PROMPT =
  '你是一位严谨的解题助手。用户会给你网页上截取的一道题目（可能附文本和图片）。请仔细阅读，输出严格的 JSON：{"answer":"...", "reasoning":"..."}，不要任何额外文字、不要 markdown 代码块。answer 用最简洁的方式给出最终答案；reasoning 解释关键步骤（中文）。';

let providers = [];

function $(id) { return document.getElementById(id); }

function newId() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalizeProvider(p, i) {
  const src = p || {};
  const label = String(src.label || "").trim();
  const endpoint = String(src.endpoint || "").trim();
  const model = String(src.model || "").trim();
  return {
    id: String(src.id || newId() + "_" + i),
    label: label || ("服务商 " + (i + 1)),
    endpoint: endpoint || PROVIDER_DEFAULTS.endpoint,
    apiKey: String(src.apiKey || ""),
    model: model || PROVIDER_DEFAULTS.model,
    enabled: src.enabled !== false,
  };
}

// --- Provider list UI -----------------------------------------------------

function renderProviders(list) {
  providers = list.map(normalizeProvider);
  const box = $("providers");
  box.innerHTML = "";
  if (!providers.length) {
    const empty = document.createElement("p");
    empty.className = "muted provider-empty";
    empty.textContent = "尚未添加服务商。点下方「＋ 添加服务商」，填入 Endpoint / API Key / Model。";
    box.appendChild(empty);
    return;
  }
  providers.forEach((p) => box.appendChild(providerCard(p)));
}

function providerCard(p) {
  const card = document.createElement("div");
  card.className = "provider";
  card.dataset.id = p.id;
  card.innerHTML =
    '<div class="provider-head">' +
      '<label class="chk"><input type="checkbox" class="p-enabled" /> 启用</label>' +
      '<input class="p-label" type="text" placeholder="名称（如 DeepSeek）" />' +
      '<button class="p-del" type="button" title="删除该服务商">删除</button>' +
    '</div>' +
    '<label>Endpoint（不含 <code>/chat/completions</code>）' +
      '<input class="p-endpoint" type="text" placeholder="https://api.openai.com/v1" /></label>' +
    '<label>API Key<input class="p-key" type="password" placeholder="sk-..." /></label>' +
    '<label>Model<input class="p-model" type="text" placeholder="gpt-4o-mini" /></label>' +
    '<div class="row"><button class="p-test" type="button">测试</button>' +
      '<span class="p-status muted"></span></div>';

  card.querySelector(".p-enabled").checked = p.enabled;
  card.querySelector(".p-label").value = p.label;
  card.querySelector(".p-endpoint").value = p.endpoint;
  card.querySelector(".p-key").value = p.apiKey;
  card.querySelector(".p-model").value = p.model;

  card.querySelector(".p-del").addEventListener("click", () => {
    providers = collectProviders().filter((x) => x.id !== p.id);
    renderProviders(providers);
    markDirty();
  });
  card.querySelector(".p-test").addEventListener("click", () => testProvider(card));
  card.querySelectorAll("input").forEach((el) => {
    el.addEventListener(el.type === "checkbox" ? "change" : "input", markDirty);
  });
  return card;
}

function collectProviders() {
  return Array.from(document.querySelectorAll("#providers .provider")).map((card, i) => {
    const val = (sel) => (card.querySelector(sel)?.value || "").trim();
    return {
      id: card.dataset.id || newId() + "_" + i,
      label: val(".p-label") || ("服务商 " + (i + 1)),
      endpoint: val(".p-endpoint") || PROVIDER_DEFAULTS.endpoint,
      apiKey: val(".p-key"),
      model: val(".p-model") || PROVIDER_DEFAULTS.model,
      enabled: !!card.querySelector(".p-enabled").checked,
    };
  });
}

function addProvider() {
  // Sync any in-flight edits before re-rendering, or they'd be lost.
  providers = collectProviders();
  providers.push({
    id: newId(),
    label: "服务商 " + (providers.length + 1),
    endpoint: PROVIDER_DEFAULTS.endpoint,
    apiKey: "",
    model: PROVIDER_DEFAULTS.model,
    enabled: true,
  });
  renderProviders(providers);
  markDirty();
  const cards = document.querySelectorAll("#providers .provider");
  const last = cards[cards.length - 1];
  if (last) last.querySelector(".p-label").focus();
}

// --- Persistence ----------------------------------------------------------

function load() {
  chrome.storage.sync.get(FIELDS.concat(LEGACY_KEYS), (cfg) => {
    let list = Array.isArray(cfg.providers) ? cfg.providers : null;
    if (!list) {
      // One-time migration from the single-endpoint layout.
      const hasLegacy = LEGACY_KEYS.some((k) => cfg[k]);
      list = hasLegacy
        ? [{ id: "p1", label: "默认", endpoint: cfg.endpoint, apiKey: cfg.apiKey, model: cfg.model, enabled: true }]
        : [];
    }
    renderProviders(list);

    const t = (cfg.temperature === undefined ? 0.2 : cfg.temperature);
    $("temperature").value = t;
    $("tempV").textContent = Number(t).toFixed(1);
    $("systemPrompt").value = cfg.systemPrompt || REASONING_PROMPT;
    $("reasoningPrompt").value = cfg.reasoningPrompt || REASONING_PROMPT;
    $("bubbleOpacity").value = (cfg.bubbleOpacity === undefined ? 0.95 : cfg.bubbleOpacity);
    $("opaV").textContent = Number($("bubbleOpacity").value).toFixed(2);
    $("saveHistory").checked = (cfg.saveHistory === undefined ? true : !!cfg.saveHistory);
    // Migrate any pre-existing 'answer' mode users to 'reason' so the answer-only path is gone.
    const mode = (cfg.promptMode === "answer" || !cfg.promptMode) ? "reason" : cfg.promptMode;
    const radio = document.querySelector('input[name="promptMode"][value="' + mode + '"]');
    if (radio) radio.checked = true;
    refreshPromptBoxes();
  });
}

function refreshPromptBoxes() {
  const mode = getMode();
  $("reasoningBox").style.display = (mode === "reason") ? "block" : "none";
  $("customBox").style.display = (mode === "custom") ? "block" : "none";
}

function getMode() {
  const r = document.querySelector('input[name="promptMode"]:checked');
  return r ? r.value : "reason";
}
let dirty = false;

function markDirty() {
  if (dirty) return;
  dirty = true;
  $("saveRes").textContent = "● 有未保存的修改";
  $("saveRes").classList.add("aqh-dirty");
}

function clearDirty() { dirty = false; $("saveRes").classList.remove("aqh-dirty"); }

function save() {
  const next = {
    providers: collectProviders(),
    temperature: Number($("temperature").value),
    systemPrompt: $("systemPrompt").value,
    promptMode: getMode(),
    reasoningPrompt: $("reasoningPrompt").value,
    bubbleOpacity: Number($("bubbleOpacity").value),
    saveHistory: $("saveHistory").checked,
  };
  chrome.storage.sync.set(next, () => {
    const err = chrome.runtime && chrome.runtime.lastError;
    if (err) {
      const msg = err.message || "";
      $("saveRes").textContent = /quota/i.test(msg)
        ? "保存失败：超出 chrome.storage.sync 单条 8KB 上限，请减少服务商数量或缩短字段。"
        : ("保存失败：" + msg);
      return;
    }
    providers = next.providers;
    clearDirty();
    $("saveRes").textContent = "✓ 已保存。当前模式：" + getMode();
    setTimeout(() => {
      if (!dirty) $("saveRes").textContent = "";
    }, 3000);
  });
}

// --- Connection test ------------------------------------------------------

async function testProvider(card) {
  const status = card.querySelector(".p-status");
  const endpoint = (card.querySelector(".p-endpoint").value || "").trim();
  const apiKey = (card.querySelector(".p-key").value || "").trim();
  const model = (card.querySelector(".p-model").value || "").trim() || PROVIDER_DEFAULTS.model;
  if (!apiKey) { status.textContent = "缺少 API Key"; status.classList.remove("ok"); return; }
  status.textContent = "测试中…";
  status.classList.remove("ok");
  try {
    const res = await fetch(endpoint.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: "只输出 OK" },
          { role: "user", content: "ping" },
        ],
      }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    await res.json();
    status.textContent = "✓ 连接正常";
    status.classList.add("ok");
  } catch (e) {
    status.textContent = "失败：" + e.message;
  }
}

async function testAll() {
  const cards = Array.from(document.querySelectorAll("#providers .provider"));
  if (!cards.length) { $("testRes").textContent = "先添加服务商"; return; }
  $("testRes").textContent = "测试中…";
  await Promise.all(cards.map((c) => testProvider(c)));
  const failed = cards.filter((c) => !c.querySelector(".p-status").classList.contains("ok")).length;
  $("testRes").textContent = failed ? (failed + " / " + cards.length + " 个未通过") : "✓ 全部正常";
}

// --- History --------------------------------------------------------------

function loadHistory() {
  chrome.storage.local.get({ history: [] }, ({ history }) => {
    const box = $("historyBox");
    box.innerHTML = "";
    history.forEach((h) => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML =
        '<div><b>' + new Date(h.ts).toLocaleString() + '</b> · <span class="muted">' +
        escapeHtml(h.provider || "") + " " + escapeHtml(h.model || "") + " " + escapeHtml(h.mode || "") +
        '</span></div>' +
        '<div class="muted">问题：' + escapeHtml(h.question || "").slice(0, 200) + '</div>' +
        '<div><b>答案：</b>' + escapeHtml(h.answer || "") + '</div>' +
        (h.reasoning ? '<div class="muted">解析：' + escapeHtml(h.reasoning).slice(0, 400) + '</div>' : "");
      box.appendChild(div);
    });
  });
}

function clearHistory() {
  chrome.storage.local.set({ history: [] }, loadHistory);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  $("saveBtn").addEventListener("click", save);
  $("addProvider").addEventListener("click", addProvider);
  $("testBtn").addEventListener("click", testAll);
  $("clearHistory").addEventListener("click", clearHistory);
  $("viewHistory").addEventListener("click", loadHistory);
  // Mark the form dirty on any change. The user must still click 保存 to persist.
  document.querySelectorAll('input[name="promptMode"]').forEach((r) => {
    r.addEventListener("change", () => { refreshPromptBoxes(); markDirty(); });
  });
  const trackedIds = [
    "systemPrompt", "reasoningPrompt", "saveHistory",
  ];
  trackedIds.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener(el.type === "checkbox" ? "change" : "input", markDirty);
  });
  $("temperature").addEventListener("input", (e) => {
    $("tempV").textContent = Number(e.target.value).toFixed(1);
    markDirty();
  });
  $("bubbleOpacity").addEventListener("input", (e) => {
    $("opaV").textContent = Number(e.target.value).toFixed(2);
    markDirty();
  });
  // Warn the user if they try to leave the page with unsaved changes.
  window.addEventListener("beforeunload", (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });
});