/** @license MIT — QuizKing · 答题王 options page. */
const FIELDS = [
  "endpoint",
  "apiKey",
  "model",
  "temperature",
  "systemPrompt",
  "promptMode",
  "reasoningPrompt",
  "bubbleOpacity",
  "saveHistory",
];

const REASONING_PROMPT =
  '你是一位严谨的解题助手。用户会给你网页上截取的一道题目（可能附文本和图片）。请仔细阅读，输出严格的 JSON：{"answer":"...", "reasoning":"..."}，不要任何额外文字、不要 markdown 代码块。answer 用最简洁的方式给出最终答案；reasoning 解释关键步骤（中文）。';

function $(id) { return document.getElementById(id); }

function load() {
  chrome.storage.sync.get(FIELDS, (cfg) => {
    $("endpoint").value = cfg.endpoint || "https://api.openai.com/v1";
    $("apiKey").value = cfg.apiKey || "";
    $("model").value = cfg.model || "gpt-4o-mini";
    const t = (cfg.temperature === undefined ? 0.2 : cfg.temperature);
    $("temperature").value = t;
    $("tempV").textContent = Number(t).toFixed(1);
    $("systemPrompt").value = cfg.systemPrompt || REASONING_PROMPT;
    $("reasoningPrompt").value = cfg.reasoningPrompt || REASONING_PROMPT;
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
    endpoint: $("endpoint").value.trim() || "https://api.openai.com/v1",
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || "gpt-4o-mini",
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
      $("saveRes").textContent = "保存失败：" + err.message;
      return;
    }
    clearDirty();
    $("saveRes").textContent = "✓ 已保存。当前模式：" + getMode();
    setTimeout(() => {
      if (!dirty) $("saveRes").textContent = "";
    }, 3000);
  });
}

async function testConn() {
  $("testRes").textContent = "测试中…";
  const cfg = await new Promise((r) => chrome.storage.sync.get(["endpoint","apiKey","model"], r));
  if (!cfg.apiKey) { $("testRes").textContent = "缺少 API Key"; return; }
  try {
    const res = await fetch((cfg.endpoint || "").replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model || "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "system", content: "只输出 OK" },
          { role: "user", content: "ping" },
        ],
      }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    await res.json();
    $("testRes").textContent = "✓ 连接正常";
  } catch (e) {
    $("testRes").textContent = "失败：" + e.message;
  }
}

function loadHistory() {
  chrome.storage.local.get({ history: [] }, ({ history }) => {
    const box = $("historyBox");
    box.innerHTML = "";
    history.forEach((h) => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML =
        '<div><b>' + new Date(h.ts).toLocaleString() + '</b> · <span class="muted">' +
        (h.model || "") + " " + (h.mode || "") + '</span></div>' +
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
  $("testBtn").addEventListener("click", testConn);
  $("clearHistory").addEventListener("click", clearHistory);
  $("viewHistory").addEventListener("click", loadHistory);
  $("temperature").addEventListener("input", (e) => {
    $("tempV").textContent = Number(e.target.value).toFixed(1);
  });
  $("bubbleOpacity").addEventListener("input", (e) => {
    $("opaV").textContent = Number(e.target.value).toFixed(2);
  });
  // Mark the form dirty on any change. The user must still click 保存 to persist.
  document.querySelectorAll('input[name="promptMode"]').forEach((r) => {
    r.addEventListener("change", () => { refreshPromptBoxes(); markDirty(); });
  });
  const trackedIds = [
    "endpoint", "apiKey", "model", "systemPrompt", "reasoningPrompt", "saveHistory",
  ];
  trackedIds.forEach((id) => {
    const el = $(id);
    if (!el) return;
    const ev = el.tagName === "SELECT" || el.type === "checkbox" || el.type === "radio" ? "change" : "input";
    el.addEventListener(ev, markDirty);
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
