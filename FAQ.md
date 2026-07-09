# FAQ

常见问题。Issue 之前先扫一遍这里。

## 安装 / 卸载

**Q: 安装后图标不出现？**
A: 检查 `chrome://extensions/` 是否有红色错误条。最常见：`src/_locales/zh_CN/messages.json` 缺失或 `manifest.json` JSON 损坏。重新加载一次即可。

**Q: 卸载后我的数据还在吗？**
A: 卸载扩展会清掉 `chrome.storage.sync` 里的配置（endpoint / key / model / prompt）。`chrome.storage.local` 里的历史记录也会清（Chrome 卸载扩展的默认行为）。备份靠你自己导出。

## 配置

**Q: 我可以接 DeepSeek / 火山方舟 / Ollama 吗？**
A: 任何 OpenAI 兼容的 `/v1/chat/completions` endpoint 都可以。Endpoint 填 base URL，**不要**带 `/chat/completions` 后缀，代码自动拼。

**Q: 截图通道要什么模型？**
A: 多模态模型。OpenAI `gpt-4o-mini` / `gpt-4o`、DeepSeek 暂无视觉、火山 `doubao-1.5-vision`、阿里 `qwen-vl-max`、本地 Ollama `llava` 都可以。

**Q: 提示词可以自定义吗？**
A: 选项页 → Prompt 模式 → 「自定义」单选，下方出现 system prompt 编辑框，点保存。改后立刻生效。

**Q: 「只要答案」和「答案 + 解析」会冲突吗？**
A: 不会。两个模式都要求模型回 JSON `{answer, ...}`，只是 reasoning 字段是否渲染。

## 使用

**Q: 划词没反应？**
A: 检查是否有 `getSelection().toString()` 文本。有些页面（如 PDF reader、Shadow DOM）`window.getSelection` 拿不到。试试「整页 DOM 文本」或「截图」通道。

**Q: 截图框选一闪就退出？**
A: 把「划段文字 → Ctrl+Shift+E」改成至少拖 3 像素再松手。1 px 内的 click 算作取消。`Ctrl+Shift+H` 是隐藏气泡（不是框选）。

**Q: 截图发给 LLM 安全吗？**
A: 截图经 `canvas` 重画后 base64 → POST 到你填的 endpoint。中间**不**经过我们任何服务器。endpoint 是你自己配置的（OpenAI / DeepSeek / 自建）。

**Q: 气泡一直不消失？**
A: `Ctrl+Shift+H` 切换。或点气泡右上角 `—`（最小化）/ `✕`（关闭，**会清空内容**）。

## 故障排查

**Q: 状态栏「未配置 API Key」？**
A: 选项页填 key → 底部「保存」（不是「测试连接」）。看 status 出现「✓ 已保存」。

**Q: 状态栏「失败：HTTP 401」？**
A: API key 无效或被吊销。回选项页重新粘贴。

**Q: 状态栏「失败：HTTP 404」？**
A: Endpoint 路径写错。`https://api.openai.com/v1` 是对的（**不要**加 `/chat/completions`，代码自动拼）。

**Q: 状态栏「CORS / Failed to fetch」？**
A: 你的 endpoint 没开 CORS。**Ollama** 默认 `http://localhost:11434/v1` 在 Chrome 里**禁止**跨域，要自建反代或换用其他 endpoint。

**Q: 模型回了 reasoning 但气泡不显示？**
A: 检查选项页 Prompt 模式。如果是「只要答案」，UI 强制不显示 reasoning。切到「答案 + 解析」再试。

## 开发者

**Q: 怎么调试？**
A: 普通网页 F12 → console 找 `[aqh]` 日志。Service worker 日志在 `chrome://extensions/` → QuizKing → 「service worker」链接。

**Q: 离线自检路由？**
A: SW DevTools 跑：
```js
self.__AQH_SELFTEST__ = true;
chrome.runtime.sendMessage({ type: "aqh/selftest" }, console.log);
```
返回 `{ ok, cfg, routes, flags }` 表示消息通道正常，不依赖 LLM。

**Q: 我能 fork 后打包到 Chrome Web Store 吗？**
A: 欢迎。MIT 协议允许，**请保留原作者署名 + LICENSE 文件**。
