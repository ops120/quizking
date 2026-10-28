/**
 * QuizKing Ultimate — highlight.js
 * 视觉反馈：高亮遮罩 + 虚拟光标 + 右下角消息面板
 * 来源：interface-assistant 移植
 */

window.QuizHighlight = (() => {
  // 视觉特效总开关（选项页「自动答题视觉特效」，默认开）：
  // 关闭后高亮遮罩 / 虚拟光标 / 消息面板全部停用，并清理已注入的特效节点。
  // 气泡内的答案展示不受影响（那条路由走 content.js 的 renderBubble）。
  let fxEnabled = true;

  function configure(opts) {
    if (opts && typeof opts.fxEnabled === 'boolean') {
      fxEnabled = opts.fxEnabled;
      if (!fxEnabled) cleanup();
    }
  }

  function injectStyles() {
    if (document.getElementById('qku-styles')) return;
    const style = document.createElement('style');
    style.id = 'qku-styles';
    style.textContent = `
      .qku-highlight {
        position:fixed!important;pointer-events:none!important;z-index:2147483646!important;
        border:3px solid #ff6b35!important;border-radius:6px!important;
        background:rgba(255,107,53,0.12)!important;
        box-shadow:0 0 20px rgba(255,107,53,0.4),inset 0 0 20px rgba(255,107,53,0.08)!important;
        transition:all 0.25s cubic-bezier(0.4,0,0.2,1)!important;
        animation:qku-pulse 1.5s ease-in-out infinite!important;
      }
      @keyframes qku-pulse {
        0%,100%{box-shadow:0 0 15px rgba(255,107,53,0.3),inset 0 0 15px rgba(255,107,53,0.05)}
        50%{box-shadow:0 0 30px rgba(255,107,53,0.6),inset 0 0 25px rgba(255,107,53,0.12)}
      }
      .qku-cursor {
        position:fixed!important;pointer-events:none!important;z-index:2147483647!important;
        width:24px!important;height:24px!important;
        transition:all 0.28s cubic-bezier(0.34,1.56,0.64,1)!important;
      }
      .qku-cursor::before {
        content:''!important;position:absolute!important;top:0!important;left:0!important;
        width:0!important;height:0!important;
        border-left:12px solid #ff6b35!important;border-top:8px solid transparent!important;
        border-bottom:16px solid transparent!important;
        filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))!important;
      }
      .qku-panel {
        position:fixed!important;bottom:70px!important;right:20px!important;z-index:2147483645!important;
        background:linear-gradient(135deg,#1a1a2e,#16213e)!important;color:#e0e0e0!important;
        border:1px solid rgba(255,107,53,0.3)!important;border-radius:12px!important;
        padding:12px 16px!important;font-family:'Segoe UI','PingFang SC',sans-serif!important;
        font-size:13px!important;max-width:320px!important;
        box-shadow:0 8px 32px rgba(0,0,0,0.4)!important;
        animation:qku-slideIn 0.3s ease-out!important;line-height:1.5!important;
      }
      @keyframes qku-slideIn {
        from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}
      }
      .qku-panel .qa-title{color:#ff6b35!important;font-weight:600!important;margin-bottom:4px!important;font-size:12px!important;text-transform:uppercase!important}
      .qku-panel .qa-msg{color:#ccc!important}
      .qku-panel .qa-reason{margin-top:6px!important;padding-top:6px!important;border-top:1px solid rgba(255,255,255,0.1)!important;font-size:12px!important;color:#999!important}
      .qku-panel.qa-warn{border-color:rgba(255,193,7,0.5)!important}
      .qku-panel.qa-ok{border-color:rgba(76,175,80,0.5)!important}
    `;
    // head 在极少数上下文（文档未就绪的 iframe）可能为 null，兜底挂到根元素，
    // 避免抛 "Cannot read properties of null (reading 'appendChild')"
    (document.head || document.documentElement).appendChild(style);
  }

  // doc：可选，题目所在的 iframe 文档；遮罩会画在该文档内（position:fixed 相对其视口，位置正好吻合）
  function highlightElement(selector, doc) {
    if (!fxEnabled) return;
    try {
      const d = doc || document;
      const old = d.querySelector('.qku-highlight');
      if (old) old.remove();
      const el = d.querySelector(selector);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const div = d.createElement('div');
      div.className = 'qku-highlight';
      div.style.left = (r.left - 2) + 'px';
      div.style.top = (r.top - 2) + 'px';
      div.style.width = (r.width + 4) + 'px';
      div.style.height = (r.height + 4) + 'px';
      (d.body || d.documentElement).appendChild(div);
    } catch(e) { /* ignore */ }
  }

  function moveCursor(selector, doc) {
    if (!fxEnabled) return;
    try {
      const d = doc || document;
      let cursor = d.querySelector('.qku-cursor');
      if (!cursor) {
        cursor = d.createElement('div');
        cursor.className = 'qku-cursor';
        (d.body || d.documentElement).appendChild(cursor);
      }
      const el = d.querySelector(selector);
      if (!el) return;
      const r = el.getBoundingClientRect();
      cursor.style.left = (r.left + r.width / 2 - 4) + 'px';
      cursor.style.top = (r.top + r.height / 2 - 16) + 'px';
    } catch(e) {}
  }

  function showPanel(title, message, reason) {
    if (!fxEnabled) return;
    try {
      const old = document.querySelector('.qku-panel');
      if (old) old.remove();
      const div = document.createElement('div');
      div.className = 'qku-panel';
      div.innerHTML = '<div class="qa-title">' + escapeHtml(title) + '</div>' +
        '<div class="qa-msg">' + escapeHtml(message) + '</div>' +
        (reason ? '<div class="qa-reason">' + escapeHtml(reason) + '</div>' : '');
      document.body.appendChild(div);
      setTimeout(() => { div.style.transition = 'opacity 0.5s'; div.style.opacity = '0'; setTimeout(() => div.remove(), 500); }, 4000);
    } catch(e) {}
  }

  function showStatus(text, type) {
    if (!fxEnabled) return;
    showPanel(type === 'ok' ? '✅' : type === 'warn' ? '⚠' : '📋', text, '');
    const panel = document.querySelector('.qku-panel');
    if (panel && type) panel.classList.add('qa-' + type);
  }

  function cleanup() {
    document.querySelectorAll('.qku-highlight,.qku-cursor,.qku-panel').forEach(el => el.remove());
  }

  function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  injectStyles();

  return { highlightElement, moveCursor, showPanel, showStatus, cleanup, configure, injectStyles };
})();