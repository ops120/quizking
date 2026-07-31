/** @license MIT — QuizKing · 答题王 toolbar popup. */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-k]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const k = btn.getAttribute("data-k");
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      // show-fab is a direct message (no capture payload), the rest go through aqh/capture.
      const msg = (k === "show-fab")
        ? { type: "aqh/show-fab" }
        : { type: "aqh/capture", payload: { kind: k } };
      chrome.tabs.sendMessage(tab.id, msg, (res) => {
        if (chrome.runtime.lastError) { $("status").textContent = "当前页面不可用"; return; }
        if (k === "show-fab" && res && typeof res.shown === "boolean") {
          $("status").textContent = res.shown ? "已召唤 王字气泡" : "已收起 王字气泡";
        }
      });
      if (k !== "show-fab") $("status").textContent = "已发送：" + k;
    });
  });
  $("opts").addEventListener("click", () => chrome.runtime.openOptionsPage());

  chrome.runtime.sendMessage({ type: "aqh/test" }, (res) => {
    if (!res || !res.ok) {
      $("status").textContent = "插件暂未就绪";
      return;
    }
    $("keyState").textContent = res.hasKey ? "API Key ✓" : "未配置 API Key";
  });
});

function $(id) { return document.getElementById(id); }
