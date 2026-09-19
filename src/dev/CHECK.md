# QuizKing · 答题王 — 手测脚本 (Manual Smoke Test)

目的：在真实 Chrome / Edge 浏览器里，逐步验证「加载扩展 → 配置 → 三种采集 → 气泡渲染 → LLM 答题」端到端可用。
适用版本：`manifest_version: 3`，`src/` 目录加载。

## 0. 前置

- 浏览器：Chrome ≥ 114 或 Edge（MV3）；账号/代理按需。
- 已安装：Node 仅在「自检 Hook」段落需要（见 §7）。
- 目标页面：随便找一个含中文 / 公式 / 截图可解题的网页（如课程页面、知乎、博客题解）。
- 准备好 LLM endpoint + apiKey（OpenAI / DeepSeek / Ollama OpenAI-兼容均可）。

## 1. 加载已解压扩展

1. 打开 `chrome://extensions/`（Edge 类似 `edge://extensions/`）。
2. 右上角打开 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择本仓库 `src/` 目录。
4. 期望：
   - 扩展卡片标题为 *QuizKing · 答题王*。
   - 「Service Worker」一栏状态显示 *已激活* / 绿色圆点（不是「已停止」）。
   - *Inspect views: service worker* 点击打开 DevTools 无红色错误。
   - 工具栏出现扩展图标（图标占位 `icons/icon*.png`）。
5. 常见异常：
   - *Manifest is not valid JSON* → 检查 `manifest.json` 末尾逗号或中文标点。
   - *Service worker registration failed* → `background.js` 顶部的 `import` 引用了不存在的路径；本项目只用 MV3 module，无外部 import，应当空。
   - *Permission 'tabs' is required* → 不要手动改 manifest；当前已经声明 `activeTab`+`scripting`，截图走 `chrome.tabs.captureVisibleTab`，无需 `tabs`。

## 2. 打开选项页并填写服务商（可多个）

1. 工具栏图标 → 弹 popup → 点 **设置**；或右键扩展 → *选项*；或 `chrome://extensions/` → 该卡片 *Details* → *Extension options*。
2. 期望打开新标签页：`options.html`，「LLM 连接」区显示服务商列表（空态时提示「尚未添加服务商」）。
3. 点 **＋ 添加服务商**，为每个服务商填写：
   - `名称`：自定义标签（如 `DeepSeek`），气泡里用它标识答案来源。
   - `Endpoint`：`https://api.openai.com/v1`（或 DeepSeek `https://api.deepseek.com/v1` 等），**不要**带尾部 `/chat/completions`。
   - `API Key`：`sk-...`（粘贴）。
   - `Model`：默认 `gpt-4o-mini`，按需替换。
   - `启用`：取消勾选即停用该服务商（不删配置）。
   - 可选（全局共用）：`Temperature`、`System Prompt`、`气泡透明度`、`保存历史`。
4. **多 API 对比**：再加一条不同 endpoint（或同 endpoint 换 model），两条都勾选 → 抓题时并行调用。
5. 点页面底部 **保存** → `#saveRes` 显示「已保存。」数秒后清空。
6. 期望：刷新页面（保留 storage.sync），所有服务商与字段值仍在。
7. 旧版本升级：原 `endpoint`/`apiKey`/`model` 会自动迁移为第一条服务商（`label: "默认"`），无需重填。

## 3. 测试连接

1. 在选项页点某条服务商的 **测试** → 该行右侧显示「测试中…」。
2. 等 1~3 秒（取决于网络与 endpoint）。
3. 期望该行显示 `✓ 连接正常`（绿色）；点 **测试全部** 则所有行并发测试，底部 `#testRes` 汇总为 `✓ 全部正常` 或 `n / m 个未通过`。
4. 失败常见原因：
   - 「缺少 API Key」→ 回到 §2，确认 key 已保存（注意：粘贴时可能含空格）。
   - 「失败：HTTP 401 / 403」→ key 无效或 endpoint 不匹配该 key 的鉴权头。
   - 「失败：HTTP 404」→ 端点 base 写错，路径 `/chat/completions` 是代码自动追加的（见 `background.js callProvider()` 中 `(provider.endpoint || PROVIDER_DEFAULTS.endpoint).replace(/\/$/, "") + "/chat/completions"`）。
   - `CORS / Failed to fetch` → 你的 endpoint 未开启浏览器跨域；Ollama 默认 `http://localhost:11434/v1` 在 Chrome 里 **禁止跨域**，需自建反代或换其他 endpoint。
5. 选填项：在弹 popup 看 `keyState` 是否变为 `API Key ✓`（多个服务商时显示 `API Key ✓ · N 个服务商`，来自 `aqh/test` 消息，`popup.js`）。

## 4. 三种采集通道 — 快捷键

> Chrome 桌面上焦点必须在 *普通网页*（不是 `chrome://`、PDF、扩展页），且目标页面不要禁用 JS。
> 快捷键可在 `chrome://extensions/shortcuts` 重新绑定。

### 4.1 Ctrl+Shift+Q — 划词（selection）

1. 用鼠标在任意段落里 `drag-select` 一段 **>=1 个字符** 的文本（数学题 / 单词 / 单行代码皆可）。
2. 按 **Ctrl+Shift+Q**。
3. 期望：
   - 页面右下角 / 拖动钉住处 出现 `id=aqh-root > #aqh-bubble` 气泡。
   - 头部：标题「QuizKing · 答题王」+ ⚙ / — / ✕ 按钮。
   - 正文：先显示 `.aqh-reasoning-block`「已捕获 `[selection] …`」+ `#aqh-status` 出现 spinner + 「正在向 LLM 发送请求…」（启用多个服务商时为「正在向 N 个模型并行发送请求…」）。
   - 数秒后，正文改成 **答案** 块（`.aqh-answer-block`，如 `42`）+ **解析** 块（`.aqh-reasoning-block`，中文步骤）；底部状态变「完成。」。
   - **启用多个服务商时**：气泡**先**显示 `.aqh-consensus.aqh-wait` 灰色徽章（`等待模型返回… · N 个等待中`）+ N 张虚线 `.aqh-item-pending` 占位卡（头部右侧标「等待中…」），状态栏为「已返回 0/N，等待其余模型…」。
   - 随后**每返回一个就填一张**（不必等最慢的）：该卡变为实线并显示答案、耗时与折叠的 `<details>` 解析；状态栏计数递增。徽章在此期间实时重算（如 `⚠ 答案各不相同 · 1 个等待中`）。
   - 全部落定后：徽章定稿（`✓ N 个模型答案一致` / `⚠ 答案不一致（2/3 一致）` / `⚠ 答案各不相同`），失败卡为 `.aqh-item-fail` 红色显示原因；少数派卡片带 `.aqh-minority` 与「少数」角标。
   - 单个服务商 45s 无响应 → 该卡显示「超时（45s 无响应）」，其余结果不受影响。
   - **只启用一个服务商时**：不出现徽章与占位卡，直接是原来的「答案 + 解析」布局（下方 E2E 已验证）。
4. 异常分支：
   - 气泡内显示「未选中文本。」→ 浏览器内某些 `<input>` / `contenteditable` 内选择不会触发 `window.getSelection`；请选 `body` 文本。
   - 气泡显示「未配置 API Key」+ 「打开设置」按钮 → 点按钮直达选项页。
   - 气泡显示红色「失败：…」→ 看 popup DevTools / `chrome://extensions` service worker 控制台；LLM 报错会原样回传。

### 4.2 Ctrl+Shift+E — 截图（visible → crop → image）

1. 不选区，直接按 **Ctrl+Shift+E**。
2. 期望：页面被一层 `.aqh-mask` 半透明遮罩（`背景色 rgba(53,99,255,0.12)` + 虚线选区），屏幕中央提示「拖动鼠标框选区域，ESC 取消」。
3. 鼠标按下并拖动松开（区域高宽都 ≥10px）；ESC 取消则回到 IDLE，气泡不出现。
4. 框选完成后：内部对所选区域做 JPEG 0.85 压缩 → 走 `aqh/capture-visible-tab`（实现在 background：`chrome.tabs.captureVisibleTab`） → 复用 `aqh/ask` 模式 `image`。
5. 气泡与 §4.1 相同预期：先 spinner、再答案 / 解析。
6. 注意：**首次** 安装后的截图会让 Chrome 顶部出现「extension captured a visible tab」，且会因为没有 `<all_urls>` 之外的特殊 host 限制（`host_permissions: ["<all_urls>"]`）而正常拿到 PNG，无需另行授权。

### 4.3 Ctrl+Shift+P — 整页 DOM 文本（page）

1. 不选区、不框选，按 **Ctrl+Shift+P**。
2. 期望：
   - 若页面文本 ≥ 1 字：直接走 `getPageText()`（= `document.body.innerText.slice(0, 6000)`），气泡显示「已捕获 `[page text] …`」。
   - 若 `document.body.innerText` 为空（极少见，例如 `<noscript>` 站）：气泡显示「页面文本为空。请尝试其他通道」。
3. LLM 回复与 §4.1 一致。

## 5. 其它触发渠道（对照测试）

- 右键菜单：在文本上选中 → 右键 → *抓取选区并问 AI* → 走 background `contextMenus.onClicked` → 同样进入气泡。
- 悬浮 FAB（鼠标悬停自动展开）：在任意页面右下角找到 `id=aqh-fab`（单字 `✦`），hover 展开 `选区 / 截图 / 整页 / 气泡` 四按钮，点击对应按钮触发 capture。
  - 一次性注入防重：`window.__aqh_injected__` 守卫。
- Popup：工具栏图标 → popup 三个按钮，选 / 截 / 页 → `chrome.tabs.sendMessage({type:"aqh/capture", payload:{kind:k}})`。

## 6. 气泡交互

- ⚙ → `chrome.runtime.openOptionsPage()`，应在 *新标签页*（`options_ui.open_in_tab: true`）。
- — → 切 `classList.toggle("aqh-hide")`，隐藏整气泡；再点 — 或 §4.4 的 `Ctrl+Shift+H` 恢复。
- ✕ → `closeBubble()`，清空 `#aqh-root`（DOM 完全清掉，再次触发会重建）。
- 头部鼠标拖动：实现见 `enableDrag()`，不超过视口边界。

## 7. 为什么这里不写 Puppeteer / chrome --headless 自动化

参考 §A 的 *替代方案*。核心：MV3 service-worker + `chrome.tabs.captureVisibleTab` 需要 **真实可视窗口** 才能产出有效 PNG；headless（尤其 `--headless=new`）在不同 Chrome 版本里反复坏截图 / 命令路由，且 CI 容器无 GUI 焦点，扩展根本不会被自动加载（`chrome --load-extension` 仍受 sandbox 限制）。**真实人工手测 ≈ 5 分钟**，覆盖所有用户路径，比维护一套脆弱的 e2e 套件划算。

---

## A. 替代方案：在 background.js 加 `__AQH_SELFTEST__` Hook（**提案，非已应用**）

为未来接 e2e / DevTools-snippet 自检埋一个零侵入开关。下面是**最小 patch**，**先不动代码**，等团队 review 后再落到 `src/background.js`。

### A.1 期望行为

当扩展运行环境（手动 `service worker` DevTools console，或在 CI 里通过 `chrome.tabs.sendMessage` 注入伪 content）能拿到 `process` / `window.__AQH_SELFTEST__ = true` 时：

```js
chrome.runtime.sendMessage({ type: "aqh/selftest" })
//  →  { ok: true, cfg: DEFAULTS (sanitized，含 providers[]，逐条去 apiKey), manifest: "0.3.0", routes: [...] }
```

目的：

1. 离线断言 *background + manifest + storage 默认值* 全部 reachable，不依赖 LLM 网络。
2. CI 中能以「扩展已加载 + 一条 ping」判断 wiring 是否活。

### A.2 最小 patch（**草稿**，未应用）

插入到 `src/background.js` 顶部，紧接 `const DEFAULTS = { ... }` 之后、`ensureDefaults()` 之前：

```js
// __AQH_SELFTEST__ — 无侵入自检钩子。仅当调用方明确开启环境变量 / 全局时生效。
//   设计原则：默认行为完全不变；hook 仅在 getRuntime().sendMessage({type:"aqh/selftest"})
//   且开关满足以下任一条件时返回：
//     (a) self.__AQH_SELFTEST__ === true（service worker 内 self）
//   或
//     (b) sender 来自同一扩展（chrome.runtime.id 校验；永远为 true，无需配置）。
//   关闭开关时 type==='aqh/selftest' 走原路径 → 返回 { ok:false, error:"unknown" }。
const __AQH_SELFTEST__ = (function () {
  try {
    // Service worker 没有 process；只在 MV3 模块全局 self 上查一次。
    // 启用方法：开发者打开 service worker DevTools 跑一次 self.__AQH_SELFTEST__=true，
    // 再用其它面板/外部脚本 ping。生产环境默认 false。
    return !!self.__AQH_SELFTEST__;
  } catch {
    return false;
  }
})();
```

然后在 `chrome.runtime.onMessage.addListener` 的 `if/else` 链 **最前面** 加一条分支（与现有 `if (msg.type === "aqh/test")` 同级）：

```js
if (msg.type === "aqh/selftest") {
  if (!__AQH_SELFTEST__) {
    return sendResponse({ ok: false, error: "selftest-disabled" });
  }
  const cfg = await ensureDefaults();
  return sendResponse({
    ok: true,
    cfg: sanitizeCfg(cfg),
    defaults: DEFAULTS,
    routes: ["aqh/get-config", "aqh/capture-visible-tab", "aqh/ask", "aqh/test", "aqh/selftest"],
  });
}
```

> 任务原文里指定的契约是 `{ok:true, cfg:DEFAULTS}`，上面已 *同时* 回 `cfg`(storage 当前值，去 apiKey) + `defaults`(硬编码) + `routes`，对 debug 更有用；若要严格 1:1，删除 `routes` / `defaults` 两行即可。

### A.3 怎么打开这个开关（不开箱即用是为了零安全代价）

- 在 `chrome://extensions` 找到本扩展 → *Service worker* → *Inspect* → DevTools console：
  ```js
  self.__AQH_SELFTEST__ = true;
  ```
  注意：每次 SW 重启后需重设（MV3 SW 闲置会被回收，再启用即失效）。
- 外部脚本：构造 `chrome.runtime.sendMessage(EXT_ID, {type:"aqh/selftest"}, cb)`（需要 `externally_connectable`，目前 manifest **没有**这个字段；下面 §A.5 是改造建议）。

### A.4 不用 Puppeteer 的端到端验证动作

1. 真人在浏览器加载扩展（§1）。
2. 打开扩展 SW DevTools（§A.3）。
3. 在控制台跑：`self.__AQH_SELFTEST__=true; chrome.runtime.sendMessage({type:"aqh/selftest"}, console.log)`。
4. 看到 `{ok:true, cfg:..., routes:...}` 即 wiring 正确；不依赖 LLM 也不依赖网络。
5. 想再覆盖一次 hot path（截图）→ §4.2 的人手仍是更可靠的路径。

### A.5 想真做 headless 时的代价清单（先不做，仅记账）

- 必须：把 `manifest.json` 加 `"externally_connectable": { "matches": ["http://localhost/*"] }`（或在 CI 注入临时 patch）。
- 必须：用 Puppeteer `chrome.launch({headless:'new', args:['--load-extension=src','--disable-extensions-except=src','--no-sandbox']})`，**至少 1 个真实 tab**（`captureVisibleTab` 在无可见 tab 时报 `Cannot capture`）。
- 失败模式：`headless=new` 下 `chrome.tabs.captureVisibleTab` 偶发回空（Chromium issue 多年未修）；可改 `--headless=old` 但又被 Chrome 弃用，所以今天只剩 `--headless=false`（Xvfb / 真桌）。
- 总结：除非路线是「在 CI 里跑带 Xvfb 的真可视 Chrome」，否则把 §A.2 的 hook 落地即可满足 *冒烟*。

---

## 通过标准

- §1~§4 全绿。
- 气泡在三种模式下都能出现 *答案 / 解析* 两块区域（`aqh-answer-block` + `aqh-reasoning-block`）。
- popup 的 `keyState` 显示「API Key ✓」。
- 选项页 *测试连接* 显示「✓ 连接正常」。

任一失败 → 在浏览器 console / SW console 抓报错，回到对应章节的「异常分支」排查。
