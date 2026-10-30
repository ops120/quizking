/* QuizKing Ultimate — options.js (based on QuizKing original + autoDelay) */
const FIELDS = ["providers","temperature","systemPrompt","promptMode","reasoningPrompt","bubbleOpacity","saveHistory","autoDelay","autoBatch","silentMode","visualFx","inlineBadge","captureBox","refEnabled","dualMode","refMode","refTopK","refMaxChars"];
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
    $("captureBox").value = (cfg.captureBox === "none") ? "none" : "blue";
    const mode = (cfg.promptMode==="answer"||!cfg.promptMode)?"reason":cfg.promptMode;
    const radio = document.querySelector('input[name="promptMode"][value="'+mode+'"]');
    if (radio) radio.checked = true;
    refreshPromptBoxes();

    // 参考资料
    $("refEnabled").checked = (cfg.refEnabled === undefined ? true : !!cfg.refEnabled);
    $("dualMode").checked = !!cfg.dualMode;
    $("refMode").value = (cfg.refMode === "strict") ? "strict" : "prefer";
    $("refTopK").value = cfg.refTopK || 4;
    $("refTopKV").textContent = $("refTopK").value;
    $("refMaxChars").value = cfg.refMaxChars || 2400;
    $("refCharsV").textContent = $("refMaxChars").value;
    renderRefDocs();
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
  const next = { providers:collectProviders(), temperature:Number($("temperature").value), systemPrompt:$("systemPrompt").value, promptMode:getMode(), reasoningPrompt:$("reasoningPrompt").value, bubbleOpacity:Number($("bubbleOpacity").value), saveHistory:$("saveHistory").checked, autoDelay:parseInt($("autoDelay").value), autoBatch:parseInt($("autoBatch").value), silentMode:!!$("silentMode").checked, visualFx:!!$("visualFx").checked, inlineBadge:!!$("inlineBadge").checked, captureBox:$("captureBox").value, refEnabled:!!$("refEnabled").checked, dualMode:!!$("dualMode").checked, refMode:$("refMode").value, refTopK:parseInt($("refTopK").value), refMaxChars:parseInt($("refMaxChars").value) };
  chrome.storage.sync.set(next, () => {
    const err = chrome.runtime?.lastError;
    if (err) { $("saveRes").textContent = "保存失败："+(err.message||""); return; }
    providers = next.providers; clearDirty();
    // 对照模式靠参考资料提供「本地一侧」，资料关着打开它只会得到一堆「未启用」空卡片
    $("saveRes").textContent = (next.dualMode && !next.refEnabled)
      ? "✓ 已保存。注意：对照模式已开、但参考资料是关的 —— 卡片里不会有本地对照。"
      : "✓ 已保存。";
    setTimeout(() => { if(!dirty) $("saveRes").textContent = ""; }, 5000);
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

// ===== 参考资料（本地 Markdown 知识库）=====
// 文档原文存 chrome.storage.local.refDocs；检索由 background 完成（refs.js）。
const REF_MAX_DOC = 600000;     // 单文档上限（字），约 1.2MB 存储
const REF_MAX_TOTAL = 2400000;  // 总容量上限（字），约 4.8MB，留足配额余量

function readRefDocs() {
  return new Promise(res => chrome.storage.local.get({ refDocs: [] }, o => res(Array.isArray(o.refDocs) ? o.refDocs : [])));
}
function writeRefDocs(docs) {
  return new Promise((res, rej) => {
    chrome.storage.local.set({ refDocs: docs }, () => {
      const err = chrome.runtime.lastError;
      if (err) rej(new Error(err.message || '写入失败')); else res();
    });
  });
}
function refChars(d) { return d.chars || (d.text ? d.text.length : 0); }
function fmtChars(n) { return n >= 10000 ? (n / 10000).toFixed(1) + " 万字" : n + " 字"; }

// 统一落盘：失败（多为配额超限）时把原因显示在统计行，不抛未捕获异常
async function persistRefDocs(docs, failPrefix) {
  try { await writeRefDocs(docs); return true; }
  catch (e) {
    const st = $("refStat");
    if (st) st.textContent = (failPrefix || "保存失败") + "：" + e.message;
    return false;
  }
}

async function renderRefDocs() {
  const docs = await readRefDocs();
  const box = $("refList");
  if (!box) return;
  box.innerHTML = "";

  docs.forEach(d => {
    const row = document.createElement("div");
    row.className = "ref-item";
    row.dataset.id = d.id;
    row.innerHTML =
      '<label class="chk r-on"><input type="checkbox" />启用</label>' +
      '<span class="r-name"></span>' +
      '<span class="muted r-size"></span>' +
      '<button class="r-del" type="button">删除</button>' +
      '<pre class="r-preview" hidden></pre>';

    row.querySelector(".r-on input").checked = d.enabled !== false;
    row.querySelector(".r-name").textContent = d.name;
    row.querySelector(".r-name").title = "点击查看开头内容";
    row.querySelector(".r-size").textContent = fmtChars(refChars(d));
    row.querySelector(".r-preview").textContent = (d.text || "").slice(0, 1200);

    row.querySelector(".r-on input").addEventListener("change", async e => {
      const list = await readRefDocs();
      const it = list.find(x => x.id === d.id);
      if (it) { it.enabled = e.target.checked; await persistRefDocs(list); }
    });
    row.querySelector(".r-name").addEventListener("click", () => {
      const p = row.querySelector(".r-preview");
      p.hidden = !p.hidden;
    });
    row.querySelector(".r-del").addEventListener("click", async () => {
      const list = (await readRefDocs()).filter(x => x.id !== d.id);
      if (await persistRefDocs(list)) renderRefDocs();
    });
    box.appendChild(row);
  });

  const total = docs.reduce((n, d) => n + refChars(d), 0);
  $("refStat").textContent = docs.length
    ? docs.length + " 份文档 · 共 " + fmtChars(total) + (docs.some(d => d.enabled === false) ? "（部分已停用）" : "")
    : "未导入文档（答题时按通用知识作答）";
}

async function addRefFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const docs = await readRefDocs();
  const skipped = [];
  let added = 0;

  for (const f of files) {
    const name = f.name || "未命名.md";
    if (!/\.(md|markdown|txt)$/i.test(name) && !/^text\//.test(f.type || "")) {
      skipped.push(name + "（不是 .md/.txt）");
      continue;
    }
    let text = "";
    try { text = await f.text(); } catch (e) { skipped.push(name + "（读取失败）"); continue; }
    if (!text.trim()) { skipped.push(name + "（空文件）"); continue; }
    if (text.length > REF_MAX_DOC) { skipped.push(name + "（" + fmtChars(text.length) + "，超过单份 " + fmtChars(REF_MAX_DOC) + "）"); continue; }

    const item = {
      id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      chars: text.length,
      text,
      enabled: true,
      addedAt: Date.now()
    };
    const i = docs.findIndex(d => d.name === name);
    if (i >= 0) docs[i] = item; else docs.push(item);   // 同名覆盖
    added++;
  }

  const total = docs.reduce((n, d) => n + refChars(d), 0);
  if (total > REF_MAX_TOTAL) {
    $("refStat").textContent = "超出总容量（" + fmtChars(total) + " / " + fmtChars(REF_MAX_TOTAL) + "），未导入。请先删除部分文档。";
    return;
  }
  if (added && !(await persistRefDocs(docs, "导入失败"))) return;
  await renderRefDocs();
  if (skipped.length) {
    const tip = document.createElement("div");
    tip.className = "muted";
    tip.style.marginTop = "6px";
    tip.textContent = "已跳过：" + skipped.join("；");
    $("refList").appendChild(tip);
  }
}

function testRefSearch() {
  const q = ($("refQuery").value || "").trim();
  if (!q) { $("refTestRes").textContent = "先输入一道题"; return; }
  $("refTestRes").textContent = "检索中…";
  $("refTestBox").innerHTML = "";
  try {
    chrome.runtime.sendMessage({ type: "refs/search", payload: { query: q } }, res => {
      if (chrome.runtime.lastError) {
        $("refTestRes").textContent = "失败：" + chrome.runtime.lastError.message;
        return;
      }
      if (!res || !res.ok) {
        $("refTestRes").textContent = "失败：" + ((res && res.error) || "无响应");
        return;
      }
      $("refTestRes").textContent = (res.note || "") + "（" + res.docs + " 份文档 / " + res.chunks + " 段可检索）";
      (res.hits || []).forEach((h, i) => {
        const div = document.createElement("div");
        div.className = "item";
        div.innerHTML = '<div><b>资料' + (i + 1) + '</b> ' + escapeHtml(h.docName) +
          (h.section ? ' · ' + escapeHtml(h.section) : '') +
          ' <span class="muted">相关度 ' + h.score + ' · ' + h.chars + ' 字</span></div>' +
          '<div class="muted">' + escapeHtml(h.preview) + '…</div>';
        $("refTestBox").appendChild(div);
      });
    });
  } catch (e) {
    $("refTestRes").textContent = "失败：" + e.message;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  $("saveBtn").addEventListener("click", save);
  $("addProvider").addEventListener("click", addProvider);
  $("testBtn").addEventListener("click", testAll);
  $("clearHistory").addEventListener("click", clearHistory);
  $("viewHistory").addEventListener("click", loadHistory);
  document.querySelectorAll('input[name="promptMode"]').forEach(r => r.addEventListener("change",()=>{refreshPromptBoxes();markDirty();}));
  ["systemPrompt","reasoningPrompt","saveHistory","silentMode","visualFx","inlineBadge","captureBox"].forEach(id=>{const el=$(id);if(el)el.addEventListener(el.type==="checkbox"?"change":"input",markDirty);});
  $("temperature").addEventListener("input",e=>{$("tempV").textContent=Number(e.target.value).toFixed(1);markDirty();});
  $("bubbleOpacity").addEventListener("input",e=>{$("opaV").textContent=Number(e.target.value).toFixed(2);markDirty();});
  $("autoDelay").addEventListener("input",e=>{$("delayV").textContent=e.target.value;markDirty();});
  $("autoBatch").addEventListener("input",e=>{$("batchV").textContent=e.target.value;markDirty();});

  // 参考资料
  $("refEnabled").addEventListener("change", markDirty);
  $("dualMode").addEventListener("change", markDirty);
  $("refMode").addEventListener("change", markDirty);
  $("refTopK").addEventListener("input", e => { $("refTopKV").textContent = e.target.value; markDirty(); });
  $("refMaxChars").addEventListener("input", e => { $("refCharsV").textContent = e.target.value; markDirty(); });
  $("refPick").addEventListener("click", () => $("refFile").click());
  $("refFile").addEventListener("change", e => { addRefFiles(e.target.files); e.target.value = ""; });
  $("refClear").addEventListener("click", async () => {
    if (!confirm("确定清空全部参考资料？此操作不可撤销。")) return;
    if (await persistRefDocs([], "清空失败")) renderRefDocs();
  });
  $("refTest").addEventListener("click", testRefSearch);

  const drop = $("refDrop");
  if (drop) {
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "dragend"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", e => {
      e.preventDefault();
      drop.classList.remove("over");
      addRefFiles(e.dataTransfer && e.dataTransfer.files);
    });
  }

  window.addEventListener("beforeunload",e=>{if(dirty){e.preventDefault();e.returnValue="";}});
});