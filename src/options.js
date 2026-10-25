/* QuizKing Ultimate — options.js (based on QuizKing original + autoDelay) */
const FIELDS = ["providers","temperature","systemPrompt","promptMode","reasoningPrompt","bubbleOpacity","saveHistory","autoDelay","autoBatch","silentMode","visualFx","inlineBadge"];
// LEGACY_KEYS 仅用于向后兼容：从旧版单-provider 配置迁移到新版 providers[] 数组
const LEGACY_KEYS = ["endpoint","apiKey","model"];
const PROVIDER_DEFAULTS = { endpoint: "https://api.openai.com/v1", model: "gpt-4o-mini" };
const REASONING_PROMPT = '你是一位严谨的解题助手。用户会给你网页上截取的一道题目。请仔细阅读，输出严格的 JSON：{"answer":"...","reasoning":"..."}，不要任何额外文字、不要 markdown 代码块。answer 用最简洁的方式给出最终答案；reasoning 解释关键步骤（中文）。';

let providers = [], dirty = false;
function $(id) { return document.getElementById(id); }
function newId() { return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function normalizeProvider(p, i) {
  const src = p || {};
  return {
    id: String(src.id || newId() + "_" + i),
    label: String(src.label || "").trim() || ("服务商 " + (i+1)),
    endpoint: String(src.endpoint || "").trim() || PROVIDER_DEFAULTS.endpoint,
    apiKey: String(src.apiKey || ""),
    model: String(src.model || "").trim() || PROVIDER_DEFAULTS.model,
    enabled: src.enabled !== false
  };
}

function renderProviders(list) {
  providers = list.map(normalizeProvider);
  const box = $("providers"); box.innerHTML = "";
  if (!providers.length) {
    const empty = document.createElement("p");
    empty.className = "muted provider-empty";
    empty.textContent = "尚未添加服务商。点下方「＋ 添加服务商」。";
    box.appendChild(empty); return;
  }
  providers.forEach(p => box.appendChild(providerCard(p)));
}

function providerCard(p) {
  const card = document.createElement("div");
  card.className = "provider"; card.dataset.id = p.id;
  card.innerHTML =
    '<div class="provider-head">' +
      '<label class="chk"><input type="checkbox" class="p-enabled" /> 启用</label>' +
      '<input class="p-label" type="text" placeholder="名称（如 DeepSeek）" />' +
      '<button class="p-del" type="button" title="删除">删除</button></div>' +
    '<label>Endpoint<input class="p-endpoint" type="text" placeholder="https://api.openai.com/v1" /></label>' +
    '<label>API Key<input class="p-key" type="password" placeholder="sk-..." /></label>' +
    '<label>Model<input class="p-model" type="text" placeholder="gpt-4o-mini" /></label>' +
    '<div class="row"><button class="p-test" type="button">测试</button><span class="p-status muted"></span></div>';
  card.querySelector(".p-enabled").checked = p.enabled;
  card.querySelector(".p-label").value = p.label;
  card.querySelector(".p-endpoint").value = p.endpoint;
  card.querySelector(".p-key").value = p.apiKey;
  card.querySelector(".p-model").value = p.model;
  card.querySelector(".p-del").addEventListener("click", () => { providers = collectProviders().filter(x => x.id !== p.id); renderProviders(providers); markDirty(); });
  card.querySelector(".p-test").addEventListener("click", () => testProvider(card));
  card.querySelectorAll("input").forEach(el => el.addEventListener(el.type === "checkbox" ? "change" : "input", markDirty));
  return card;
}

function collectProviders() {
  return Array.from(document.querySelectorAll("#providers .provider")).map((card, i) => {
    const val = sel => (card.querySelector(sel)?.value || "").trim();
    return { id: card.dataset.id || newId()+"_"+i, label: val(".p-label")||("服务商 "+(i+1)), endpoint: val(".p-endpoint")||PROVIDER_DEFAULTS.endpoint, apiKey: val(".p-key"), model: val(".p-model")||PROVIDER_DEFAULTS.model, enabled: !!card.querySelector(".p-enabled").checked };
  });
}

function addProvider() {
  providers = collectProviders();
  providers.push({ id: newId(), label: "服务商 "+(providers.length+1), endpoint: PROVIDER_DEFAULTS.endpoint, apiKey: "", model: PROVIDER_DEFAULTS.model, enabled: true });
  renderProviders(providers); markDirty();
  const cards = document.querySelectorAll("#providers .provider");
  const last = cards[cards.length-1]; if (last) last.querySelector(".p-label").focus();
}

function load() {
  chrome.storage.sync.get(FIELDS.concat(LEGACY_KEYS), cfg => {
    let list = Array.isArray(cfg.providers) ? cfg.providers : null;
    if (!list) { const hasLegacy = LEGACY_KEYS.some(k => cfg[k]); list = hasLegacy ? [{ id:"p1",label:"默认",endpoint:cfg.endpoint,apiKey:cfg.apiKey,model:cfg.model,enabled:true }] : []; }
    if (!list.length) list = []; // 无配置时留空，由用户手动添加服务商
    renderProviders(list);
    $("temperature").value = (cfg.temperature===undefined?0.2:cfg.temperature);
    $("tempV").textContent = Number($("temperature").value).toFixed(1);
    $("systemPrompt").value = cfg.systemPrompt || REASONING_PROMPT;
    $("reasoningPrompt").value = cfg.reasoningPrompt || REASONING_PROMPT;
    $("bubbleOpacity").value = (cfg.bubbleOpacity===undefined?0.95:cfg.bubbleOpacity);
    $("opaV").textContent = Number($("bubbleOpacity").value).toFixed(2);
    $("saveHistory").checked = (cfg.saveHistory===undefined?true:!!cfg.saveHistory);
    $("autoDelay").value = cfg.autoDelay || 300;
    $("delayV").textContent = $("autoDelay").value;
    $("autoBatch").value = cfg.autoBatch || 5;
    $("batchV").textContent = $("autoBatch").value;
    $("silentMode").checked = !!cfg.silentMode;
    $("visualFx").checked = (cfg.visualFx===undefined?true:!!cfg.visualFx);
    const mode = (cfg.promptMode==="answer"||!cfg.promptMode)?"reason":cfg.promptMode;
    const radio = document.querySelector('input[name="promptMode"][value="'+mode+'"]');
    if (radio) radio.checked = true;
    refreshPromptBoxes();
  });
}

function refreshPromptBoxes() {
  const mode = getMode();
  $("reasoningBox").style.display = (mode==="reason")?"block":"none";
  $("customBox").style.display = (mode==="custom")?"block":"none";
}

function getMode() { const r = document.querySelector('input[name="promptMode"]:checked'); return r?r.value:"reason"; }

function markDirty() { if(dirty)return;dirty=true;$("saveRes").textContent="● 有未保存的修改";$("saveRes").classList.add("aqh-dirty"); }
function clearDirty() { dirty=false;$("saveRes").classList.remove("aqh-dirty"); }

function save() {
  const next = { providers:collectProviders(), temperature:Number($("temperature").value), systemPrompt:$("systemPrompt").value, promptMode:getMode(), reasoningPrompt:$("reasoningPrompt").value, bubbleOpacity:Number($("bubbleOpacity").value), saveHistory:$("saveHistory").checked, autoDelay:parseInt($("autoDelay").value), autoBatch:parseInt($("autoBatch").value), silentMode:!!$("silentMode").checked, visualFx:!!$("visualFx").checked, inlineBadge:!!$("inlineBadge").checked };
  chrome.storage.sync.set(next, () => {
    const err = chrome.runtime?.lastError;
    if (err) { $("saveRes").textContent = "保存失败："+(err.message||""); return; }
    providers = next.providers; clearDirty();
    $("saveRes").textContent = "✓ 已保存。";
    setTimeout(() => { if(!dirty) $("saveRes").textContent = ""; }, 3000);
  });
}

async function testProvider(card) {
  const status = card.querySelector(".p-status");
  const endpoint = (card.querySelector(".p-endpoint").value||"").trim();
  const apiKey = (card.querySelector(".p-key").value||"").trim();
  const model = (card.querySelector(".p-model").value||"").trim()||PROVIDER_DEFAULTS.model;
  if (!apiKey) { status.textContent = "缺少 API Key"; status.classList.remove("ok"); return; }
  status.textContent = "测试中…"; status.classList.remove("ok");
  try {
    const res = await fetch(endpoint.replace(/\/$/,"")+"/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+apiKey},body:JSON.stringify({model,temperature:0,messages:[{role:"system",content:"只输出 OK"},{role:"user",content:"ping"}]})});
    if (!res.ok) throw new Error("HTTP "+res.status);
    await res.json();
    status.textContent = "✓ 连接正常"; status.classList.add("ok");
  } catch(e) { status.textContent = "失败："+e.message; }
}

async function testAll() {
  const cards = Array.from(document.querySelectorAll("#providers .provider"));
  if (!cards.length) { $("testRes").textContent = "先添加服务商"; return; }
  $("testRes").textContent = "测试中…";
  await Promise.all(cards.map(c => testProvider(c)));
  const failed = cards.filter(c => !c.querySelector(".p-status").classList.contains("ok")).length;
  $("testRes").textContent = failed ? (failed+"/"+cards.length+" 个未通过") : "✓ 全部正常";
}

function loadHistory() {
  chrome.storage.local.get({ history: [] }, ({ history }) => {
    const box = $("historyBox"); box.innerHTML = "";
    history.forEach(h => {
      const div = document.createElement("div"); div.className = "item";
      div.innerHTML = '<div><b>'+new Date(h.ts).toLocaleString()+'</b> · <span class="muted">'+escapeHtml(h.provider||"")+" "+escapeHtml(h.model||"")+'</span></div>'+'<div class="muted">问题：'+escapeHtml(h.question||"").slice(0,200)+'</div>'+'<div><b>答案：</b>'+escapeHtml(h.answer||"")+'</div>'+(h.reasoning?'<div class="muted">解析：'+escapeHtml(h.reasoning).slice(0,400)+'</div>':"");
      box.appendChild(div);
    });
  });
}

function clearHistory() { chrome.storage.local.set({ history: [] }, loadHistory); }
function escapeHtml(s) { return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

document.addEventListener("DOMContentLoaded", () => {
  load();
  $("saveBtn").addEventListener("click", save);
  $("addProvider").addEventListener("click", addProvider);
  $("testBtn").addEventListener("click", testAll);
  $("clearHistory").addEventListener("click", clearHistory);
  $("viewHistory").addEventListener("click", loadHistory);
  document.querySelectorAll('input[name="promptMode"]').forEach(r => r.addEventListener("change",()=>{refreshPromptBoxes();markDirty();}));
  ["systemPrompt","reasoningPrompt","saveHistory","silentMode","visualFx","inlineBadge"].forEach(id=>{const el=$(id);if(el)el.addEventListener(el.type==="checkbox"?"change":"input",markDirty);});
  $("temperature").addEventListener("input",e=>{$("tempV").textContent=Number(e.target.value).toFixed(1);markDirty();});
  $("bubbleOpacity").addEventListener("input",e=>{$("opaV").textContent=Number(e.target.value).toFixed(2);markDirty();});
  $("autoDelay").addEventListener("input",e=>{$("delayV").textContent=e.target.value;markDirty();});
  $("autoBatch").addEventListener("input",e=>{$("batchV").textContent=e.target.value;markDirty();});
  window.addEventListener("beforeunload",e=>{if(dirty){e.preventDefault();e.returnValue="";}});
});