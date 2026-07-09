/**
 * QuizKing · 答题王 — content script injected into every page.
 * @license MIT
 *
 * Three capture modes:
 *   * selection — text selected in the page
 *   * visible   — screenshot of visible tab via background; base64 PNG (with optional user-drawn crop)
 *   * page      — DOM plain text (main visible body)
 * Sends captured payload to background (aqh/ask) and renders the bubble.
 */

(() => {
  if (window.__aqh_injected__) return;
  window.__aqh_injected__ = true;

  const ROOT_ID = "aqh-root";
  let cfg = null;
  // Per-call: result.promptMode is read inside showAnswer.
  let promptMode = "answer";

  function getRuntime() { return chrome.runtime; }

  function callBg(type, payload) {
    return new Promise((resolve) => {
      try {
        getRuntime().sendMessage({ type, payload }, (res) => resolve(res));
      } catch (e) {
        resolve({ ok: false, error: e?.message || String(e) });
      }
    });
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement("div");
    root.id = ROOT_ID;
    document.documentElement.appendChild(root);
    return root;
  }

  function getCssOpacity() {
    return Number((cfg && cfg.bubbleOpacity) ?? 0.95);
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function log(...a) { try { console.log("[aqh]", ...a); } catch (e) { void e; } }

  function renderBubble(html, opts) {
    opts = opts || {};
    const root = ensureRoot();
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.id = "aqh-bubble";
    wrap.style.opacity = String(getCssOpacity());
    if (opts.hidden) wrap.classList.add("aqh-hide");
    wrap.innerHTML =
      '<div id="aqh-header">' +
        '<div id="aqh-title"><span id="aqh-title-glyph">王</span><span id="aqh-title-text">QuizKing · 答题王</span></div>' +
        '<div id="aqh-actions">' +
          '<button data-act="settings" title="设置">⚙</button>' +
          '<button data-act="min" title="隐藏">—</button>' +
          '<button data-act="close" title="关闭">✕</button>' +
        '</div>' +
      '</div>' +
      '<div id="aqh-body">' + html + '</div>' +
      '<div id="aqh-status">' + (opts.status || "") + '</div>';
    root.appendChild(wrap);

    wrap.querySelector('[data-act="close"]').addEventListener("click", closeBubble);
    wrap.querySelector('[data-act="min"]').addEventListener("click", () => wrap.classList.toggle("aqh-hide"));
    wrap.querySelector('[data-act="settings"]').addEventListener("click", () => {
      try { chrome.runtime.openOptionsPage(); } catch (e) { void e; }
    });

    enableDrag(wrap, wrap.querySelector("#aqh-header"));
  }

  function setStatus(text, loading) {
    const status = document.getElementById("aqh-status");
    if (!status) return;
    status.innerHTML = loading
      ? '<span class="aqh-spinner"></span><span>' + escapeHtml(text) + '</span>'
      : escapeHtml(text || "");
  }

  function closeBubble() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.innerHTML = "";
  }

  function enableDrag(box, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      const r = box.getBoundingClientRect();
      ox = r.left; oy = r.top;
      sx = e.clientX; sy = e.clientY;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const nx = Math.max(0, Math.min(window.innerWidth - 80, ox + (e.clientX - sx)));
      const ny = Math.max(0, Math.min(window.innerHeight - 40, oy + (e.clientY - sy)));
      box.style.left = nx + "px";
      box.style.top = ny + "px";
      box.style.right = "auto";
      box.style.bottom = "auto";
    });
    window.addEventListener("mouseup", () => { dragging = false; });
  }

  function getSelectionText() {
    const sel = window.getSelection && window.getSelection();
    if (!sel) return "";
    return sel.toString().trim();
  }

  function getPageText(limit) {
    limit = limit || 6000;
    const root = document.body || document.documentElement;
    const text = (root.innerText || "").trim();
    return text.length > limit ? text.slice(0, limit) : text;
  }

  async function captureVisibleScreenshot() {
    const res = await callBg("aqh/capture-visible-tab");
    if (!res || !res.ok) throw new Error((res && res.error) || "截图失败");
    return res.dataUrl;
  }

  async function chooseCropAndCapture() {
    const full = await captureVisibleScreenshot();
    const rect = await pickRectOnPage();
    if (!rect) {
      log("crop: user cancelled, using full shot");
      return full;
    }
    return cropDataUrl(full, rect);
  }

  function pickRectOnPage() {
    return new Promise((resolve) => {
      const host = document.documentElement || document.body;

      const mask = document.createElement("div");
      mask.id = "aqh-mask";
      mask.style.cssText =
        "position:fixed;left:0;top:0;right:0;bottom:0;width:100%;height:100%;" +
        "z-index:2147483647;background:rgba(0,0,0,0.25);cursor:crosshair;" +
        "touch-action:none;user-select:none;";
      host.appendChild(mask);

      const hint = document.createElement("div");
      hint.id = "aqh-mask-hint";
      hint.textContent = "拖动鼠标框选区域，ESC 取消";
      hint.style.cssText =
        "position:fixed;left:50%;top:12px;transform:translateX(-50%);padding:6px 12px;" +
        "border-radius:999px;background:rgba(0,0,0,0.72);color:#fff;font-size:12px;" +
        "z-index:2147483647;pointer-events:none;user-select:none;";
      host.appendChild(hint);

      const sel = document.createElement("div");
      sel.id = "aqh-sel";
      sel.style.cssText =
        "position:fixed;border:2px dashed #3563ff;background:rgba(53,99,255,0.18);" +
        "pointer-events:none;display:none;z-index:2147483647;";
      host.appendChild(sel);

      const fab = document.getElementById("aqh-fab");
      if (fab) fab.style.pointerEvents = "none";
      const bubble = document.getElementById("aqh-bubble");
      const prevBubblePE = bubble ? bubble.style.pointerEvents : "";
      if (bubble) bubble.style.pointerEvents = "none";

      let startX = 0, startY = 0, drawing = false, moveCount = 0, finished = false;

      function done(rect, why) {
        if (finished) return;
        finished = true;
        log("done:", why, rect);
        mask.removeEventListener("mousedown", onDown);
        mask.removeEventListener("mouseup", onUp);
        mask.removeEventListener("contextmenu", onCtx);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("keydown", onKey);
        sel.remove(); hint.remove(); mask.remove();
        if (fab) fab.style.pointerEvents = "";
        if (bubble) bubble.style.pointerEvents = prevBubblePE;
        resolve(rect);
      }

      function onDown(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        drawing = true;
        startX = e.clientX;
        startY = e.clientY;
        sel.style.left = startX + "px";
        sel.style.top = startY + "px";
        sel.style.width = "0px";
        sel.style.height = "0px";
        sel.style.display = "block";
        log("down:", startX, startY);
      }

      function onMove(e) {
        if (!drawing) return;
        moveCount++;
        const left = Math.min(startX, e.clientX);
        const top = Math.min(startY, e.clientY);
        const width = Math.abs(e.clientX - startX);
        const height = Math.abs(e.clientY - startY);
        sel.style.left = left + "px";
        sel.style.top = top + "px";
        sel.style.width = width + "px";
        sel.style.height = height + "px";
      }

      function onUp(e) {
        if (!drawing) return;
        drawing = false;
        e.preventDefault();
        e.stopPropagation();
        const left = Math.min(startX, e.clientX);
        const top = Math.min(startY, e.clientY);
        const width = Math.abs(e.clientX - startX);
        const height = Math.abs(e.clientY - startY);
        log("up:", { left, top, width, height, moveCount });
        if (width < 3 || height < 3) return done(null, "too small");
        done({ left, top, width, height, dpr: window.devicePixelRatio || 1 }, "ok");
      }

      function onKey(e) {
        if (e.key === "Escape") { drawing = false; done(null, "esc"); }
      }

      function onCtx(e) { e.preventDefault(); }

      mask.addEventListener("mousedown", onDown);
      mask.addEventListener("mouseup", onUp);
      mask.addEventListener("contextmenu", onCtx);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("keydown", onKey);

      log("pick: mask shown");
    });
  }

  function cropDataUrl(dataUrl, rect) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const dpr = rect.dpr || 1;
        const sx = rect.left * dpr;
        const sy = rect.top * dpr;
        const sw = rect.width * dpr;
        const sh = rect.height * dpr;
        const targetW = Math.min(1600, sw);
        const targetH = sh * (targetW / sw);
        const c = document.createElement("canvas");
        c.width = targetW; c.height = targetH;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function askAndShow(payload, label) {
    if (!cfg || !cfg.hasKey) {
      renderBubble(
        '<div class="aqh-err">未配置 API Key。</div>' +
        '<div style="margin-top:8px">' +
          '<button id="aqh-openopts" style="appearance:none;border:0;background:#3563ff;color:#fff;padding:6px 12px;border-radius:8px;cursor:pointer">打开设置</button>' +
        '</div>',
        { status: "需要先在选项页填写 API Key" }
      );
      const b = document.getElementById("aqh-openopts");
      if (b) b.addEventListener("click", () => {
        try { chrome.runtime.openOptionsPage(); } catch (e) { void e; }
      });
      return;
    }
    renderBubble(
      '<div class="aqh-reasoning-block"><div class="aqh-reasoning-label">已捕获</div>' +
      escapeHtml(label || "(image)") + '</div>',
      { status: "正在向 LLM 发送请求…", loading: true }
    );
    const res = await callBg("aqh/ask", payload);
    if (!res || !res.ok) {
      setStatus("失败：" + ((res && res.error) || "未知错误"));
      appendError((res && res.error) || "未知错误");
      return;
    }
    showAnswer(res.result);
  }

  function appendError(msg) {
    const body = document.getElementById("aqh-body");
    if (!body) return;
    const div = document.createElement("div");
    div.className = "aqh-err";
    div.style.marginTop = "8px";
    div.textContent = msg;
    body.appendChild(div);
  }

  function showAnswer(r) {
    const body = document.getElementById("aqh-body");
    if (!body) return;
    log("showAnswer mode=", r.promptMode, "reason_len=", (r.reasoning || "").length);
    body.innerHTML = "";

    let answer = (r.answer || "").trim();
    let reasoning = (r.reasoning || "").trim();

    if (answer && (answer.startsWith("{") || answer.startsWith("`"))) {
      try {
        const obj = JSON.parse(answer.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim());
        if (obj && typeof obj === "object") {
          if (obj.answer) answer = String(obj.answer).trim();
          if (!reasoning && obj.reasoning) reasoning = String(obj.reasoning).trim();
        }
      } catch {}
    }
    if (reasoning && reasoning.startsWith("{")) {
      try {
        const obj = JSON.parse(reasoning);
        if (obj && obj.reasoning) reasoning = String(obj.reasoning).trim();
      } catch {}
    }

    // Use mode from the per-call response; fall back to module-level.
    const mode = r.promptMode || promptMode || "answer";
    // In answer-only mode, drop any reasoning the model still emitted.
    if (mode === "answer") reasoning = "";
    const showReasoning = !!(reasoning && reasoning !== answer);

    // Render
    if (answer) {
      const a = document.createElement("div");
      a.className = "aqh-answer";
      a.innerHTML =
        '<div class="aqh-answer-label">答案</div>' +
        '<div class="aqh-answer-block"></div>';
      a.querySelector(".aqh-answer-block").textContent = answer;
      body.appendChild(a);
    }
    if (showReasoning) {
      const re = document.createElement("div");
      re.className = "aqh-reasoning";
      re.style.marginTop = "8px";
      re.innerHTML =
        '<div class="aqh-reasoning-label">解析</div>' +
        '<div class="aqh-reasoning-block"></div>';
      re.querySelector(".aqh-reasoning-block").textContent = reasoning;
      body.appendChild(re);
    }
    if (!answer && !reasoning && r.raw) {
      const raw = document.createElement("div");
      raw.style.marginTop = "8px";
      raw.innerHTML = '<div class="aqh-reasoning-label">原始输出</div><div class="aqh-pre"></div>';
      raw.querySelector(".aqh-pre").textContent = r.raw;
      body.appendChild(raw);
    }
    setStatus(answer ? "完成。" : "完成（模型未返回结构化输出，已展示原始文本）。");
  }

  function ensureFab() {
    let fab = document.getElementById("aqh-fab");
    if (fab) return fab;
    fab = document.createElement("button");
    fab.id = "aqh-fab";
    fab.title = "QuizKing · 答题王";
    fab.textContent = "王";
    fab.style.fontFamily = '"PingFang SC","Microsoft YaHei",Heiti,sans-serif';
    fab.style.fontWeight = "700";
    document.documentElement.appendChild(fab);

    let expanded = false;
    let collapseTimer = null;
    const render = () => {
      if (expanded) {
        fab.classList.add("aqh-fab-expanded");
        fab.innerHTML =
          '<span class="aqh-fab-btn" data-k="selection">选区</span>' +
          '<span class="aqh-fab-btn" data-k="visible">截图</span>' +
          '<span class="aqh-fab-btn" data-k="page">整页</span>' +
          '<span class="aqh-fab-btn" data-k="toggle">气泡</span>';
        fab.querySelectorAll("[data-k]").forEach((el) => {
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            const k = el.getAttribute("data-k");
            handleTrigger(k);
            collapse();
          });
        });
      } else {
        fab.classList.remove("aqh-fab-expanded");
        fab.textContent = "王";
      }
    };
    const expand = () => { expanded = true; render(); };
    const collapse = () => { expanded = false; render(); };
    fab.addEventListener("mouseenter", () => { clearTimeout(collapseTimer); expand(); });
    fab.addEventListener("mouseleave", () => {
      clearTimeout(collapseTimer);
      collapseTimer = setTimeout(collapse, 350);
    });
    fab.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!expanded) { expand(); return; }
      handleTrigger("selection");
      collapse();
    });
    return fab;
  }

  async function handleTrigger(kind) {
    if (kind === "toggle") {
      const b = document.getElementById("aqh-bubble");
      if (b) b.classList.toggle("aqh-hide");
      else renderBubble('<div class="aqh-pre">气泡</div>', { status: "已展开" });
      return;
    }
    try {
      if (kind === "selection") {
        const text = getSelectionText();
        if (!text) {
          renderBubble('<div class="aqh-err">未选中文本。</div>', { status: "请先在页面选中文字" });
          return;
        }
        await askAndShow({ mode: "text", text }, "[selection]\n" + text);
      } else if (kind === "visible") {
        const dataUrl = await chooseCropAndCapture();
        await askAndShow(
          { mode: "image", imageDataUrl: dataUrl, text: "请分析截图中题目并回答。" },
          "[visible screenshot]"
        );
      } else if (kind === "page") {
        const text = getPageText();
        if (!text) {
          renderBubble('<div class="aqh-err">页面文本为空。</div>', { status: "请尝试其他通道" });
          return;
        }
        await askAndShow({ mode: "text", text }, "[page text]\n" + text);
      }
    } catch (e) {
      renderBubble('<div class="aqh-err">捕获失败：' + escapeHtml(e && e.message || String(e)) + '</div>');
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === "aqh/capture") {
      handleTrigger(msg.payload && msg.payload.kind || "selection");
      return sendResponse({ ok: true });
    }
    if (msg.type === "aqh/close") {
      closeBubble();
      return sendResponse({ ok: true });
    }
    if (msg.type === "aqh/ping") {
      sendResponse({ ok: true });
    }
  });

  (async () => {
    cfg = ((await callBg("aqh/get-config")) || {}).cfg || null;
    if (cfg && cfg.promptMode) promptMode = cfg.promptMode;
    log("boot promptMode=", promptMode);
    ensureFab();
  })();
})();
