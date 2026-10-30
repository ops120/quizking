/* QuizKing Ultimate — popup.js (based on QuizKing original + auto-answer) */
function $(id) { return document.getElementById(id); }

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-k]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const k = btn.getAttribute("data-k");
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      const msg = (k === "show-fab")
        ? { type: "aqh/show-fab" }
        : (k === "pause")
        ? { type: "aqh/pause-toggle" }
        : { type: "aqh/capture", payload: { kind: k } };
      chrome.tabs.sendMessage(tab.id, msg, res => {
        if (chrome.runtime.lastError) { $("status").textContent = "当前页面不可用"; return; }
        if (k === "detect" && res) {
          $("status").textContent = res.message || (res.ok ? "检测完成" : ("检测失败：" + (res.error || "未知")));
        }
        if (k === "show-fab" && res && typeof res.shown === "boolean") {
          $("status").textContent = res.shown ? "已召唤 王字气泡" : "已收起 王字气泡";
        }
        if (k === "pause" && res && typeof res.paused === "boolean") {
          $("status").textContent = res.paused ? "⏸ 已暂停" : "▶ 已继续";
        }
        if (k === "selection" && res && res.found === false) {
          $("status").textContent = "未选中文本";
        }
        if (k === "badge-toggle" && res && typeof res.visible === "boolean") {
          $("status").textContent = res.visible ? "答案徽标已显示" : "答案徽标已隐藏";
        }
      });
      if (k === "auto") $("status").textContent = "🤖 自动答题中…";
      else if (k === "detect") $("status").textContent = "🔍 检测中…";
      else if (k !== "show-fab" && k !== "pause" && k !== "selection" && k !== "badge-toggle") $("status").textContent = "已发送：" + k;
    });
  });
  $("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());

  chrome.runtime.sendMessage({ type: "aqh/test" }, res => {
    if (!res || !res.ok) { $("status").textContent = "插件暂未就绪"; return; }
    const n = res.providerCount || 0;
    const docTxt = res.refDocs ? (" · 📚" + res.refDocs) : "";
    // 对照模式影响"会不会自动填"，必须在点「自动答题」之前就能看到
    const dualTxt = res.dualMode ? " · 🖐对照" : "";
    $("keyState").textContent = (res.hasKey
      ? ("API Key ✓" + (n > 1 ? (" · " + n + " 个服务商") : ""))
      : "未配置 API Key") + docTxt + dualTxt;
    $("keyState").title = (res.refDocs
      ? ("已导入 " + res.refDocs + " 份参考资料" + (res.refEnabled ? "" : "（当前已停用）"))
      : "未导入参考资料：设置 → 📚 参考资料") +
      (res.dualMode ? "\n对照模式已开：两个答案并列，点选后才填" : "");
    // 静默模式下显示答题状态
    if (res.silentMode && res.status && res.status.text) {
      $("status").textContent = res.status.text;
    }
  });

  // 静默模式下每秒刷新状态栏，实时跟踪自动答题进度
  setInterval(() => {
    chrome.runtime.sendMessage({ type: "aqh/test" }, res => {
      if (res && res.ok && res.silentMode && res.status && res.status.text) {
        $("status").textContent = res.status.text;
      }
    });
  }, 1000);
});
