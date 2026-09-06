<div align="center">

# QuizKing · 答题王

> 把网页上看到的题目（截图 / 划词 / DOM）丢给 OpenAI 兼容 LLM，把答案 / 解析吐回悬浮气泡。

[![Release](https://img.shields.io/badge/release-v0.1.0-3563ff)](../../releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Manifest V3](https://img.shields.io/badge/manifest-V3-3563ff)](#技术栈)
[![Chrome 114+](https://img.shields.io/badge/chrome-114%2B-4285f4)](#安装)
[![No telemetry](https://img.shields.io/badge/telemetry-none-2ea44f)](#隐私与安全)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
[![Bilibili](https://img.shields.io/badge/B站-97727630-00aeec?logo=bilibili&logoColor=white)](https://space.bilibili.com/97727630)

</div>

## 目录

- [特性](#特性)
- [30 秒试用](#30-秒试用)
- [安装](#安装)
- [配置](#配置)
- [使用](#使用)
- [架构](#架构)
- [消息路由](#消息路由)
- [开发](#开发)
- [FAQ](#faq)
- [隐私与安全](#隐私与安全)
- [路线图](#路线图)
- [贡献](#贡献)
- [作者](#作者)
- [许可](#许可)

## 特性

- **三通道采集** — 划词文本 / 整页 DOM 文本 / 可见区域截图 + 框选裁剪
- **OpenAI 兼容 endpoint** — OpenAI / DeepSeek / 火山方舟 / Ollama 全部可接
- **两种 Prompt 模式** — 答案 + 解析（默认）/ 自定义
- **可拖动悬浮气泡**，可设透明度（0.4–1.0），调低后自动去色淡化、融入页面，ESC 隐藏，⚙ 跳设置
- **多触发方式** — 快捷键 / 右键菜单 / 浮动按钮 / 工具栏 popup
- **本地历史** — 最近 200 条（可关），一键清空
- **脏标记** — 选项页改了任何字段都会高亮「● 有未保存的修改」直到点保存
- **零上报** — 不接任何第三方分析 / 统计 / beacon

## 30 秒试用

```bash
# 1. 拉代码（你已经在了）
# 2. Chrome → chrome://extensions/ → 开发者模式 → 加载已解压 → 选 src/
# 3. 工具栏出现「王」字蓝色图标
# 4. 划一段文字 → Ctrl+Shift+Q → 气泡出答案
```

完整配置见 [配置](#配置)。先不填 key 也行，会跳到「未配置 API Key」提示。

![实测：划词后气泡出答案](assets/screenshots/demo.png)



## 安装

### 开发者模式（推荐，先跑通）

1. 打开 `chrome://extensions/`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」 → 选本仓库 `src/` 目录
4. 工具栏出现「王」字蓝色图标 → 安装成功

![安装插件](assets/screenshots/install.png)

> Edge 用户：在 `edge://extensions/` 同理，开发者模式 + 加载已解压。

### 从 Chrome Web Store 安装

> 发布到商店后填入永久链接。

## 配置

1. 工具栏点「王」字图标 → 「设置」打开选项页
2. 填写：
   - **Endpoint**：例如 `https://api.openai.com/v1`（**不要**带 `/chat/completions`，插件自动拼）
   - **API Key**：`sk-...`，存于 `chrome.storage.sync`，不上报
   - **Model**：默认 `gpt-4o-mini`，多模态截图建议 `gpt-4o-mini` / `qwen-vl-max` / `doubao-1.5-vision`
   - **Temperature**：拖动滑块，0–2
   - **System Prompt**：见下「Prompt 模式」
3. 点「测试连接」 → 显示 `✓ 连接正常` 即通
4. 改任何字段都会显示「● 有未保存的修改」 → 点底部「保存」

![配置模型](assets/screenshots/config.png)

### 气泡透明度

选项页「外观与历史」→「气泡透明度」滑块（0.4–1.0）。调低后气泡自动去色淡化；最低档时标题与彩色图标隐藏，只剩浅淡轮廓融入页面：

| 修改前 | 修改后（最低透明度） |
| --- | --- |
| ![透明度修改前](assets/screenshots/透明修改前.png) | ![透明度修改后](assets/screenshots/透明修改后.png) |

### Prompt 模式

| 模式 | system prompt | 气泡显示 |
| --- | --- | --- |
| 答案 + 解析（默认） | 严格 JSON `{answer, reasoning}` | 「答案」+「解析」 |
| 自定义 | 你写的文本 | 按模式判定 |

## 使用

| 快捷键 | 作用 | 何时用 |
| --- | --- | --- |
| `Ctrl+Shift+Q`（macOS `⌘⇧Q`） | **抓取选区** | 先在页面选中一段文字，按后把选中文本发给 LLM。适合：网页上能直接选中的题目。 |
| `Ctrl+Shift+E` | **抓取可见区域**（截图） | 整页变暗后拖框选区裁剪，截图发给多模态 LLM。适合：题目是图片、表格、代码截图、PDF 阅读器、反爬不让选的页面。 |
| `Ctrl+Shift+P` | **抓取整页 DOM 文本** <sub>⚠ 实验</sub> | 把整页 `innerText` 前 6000 字符发给 LLM。适合：长文章、整段题文、多选合集。⚠ **实验性**：长文本会显著增加 token 消耗与延迟；多数场景用「划词」更准。 |
| `Ctrl+Shift+H` | **显示 / 隐藏气泡** | 答题完成后想收起气泡（不丢内容），再按一次又出现。 |

> 在 `chrome://extensions/shortcuts` 可重新绑定这 4 个命令。

![快捷键说明](assets/screenshots/shortcuts.png)

**其他触发方式**

- 页面右下角悬浮「王」字按钮 → 鼠标悬停展开「选区 / 截图 / 整页 / 气泡」
- 选中文字 → 右键 → 「抓取选区并问 AI」 / 「抓取可见区域并问 AI」 / 「抓取整页 DOM 文本并问 AI」 / 「关闭当前 AI 气泡」
- 工具栏图标 → 弹 popup → 四个按钮（含详细快捷键说明）

**手测脚本**：[`src/dev/CHECK.md`](src/dev/CHECK.md) 5 分钟冒烟。

## 架构

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────┐
│  popup.html      │    │  background.js   │    │  options.html│
│  (toolbar)       │    │  (service worker)│    │  (settings)  │
└────────┬─────────┘    └────────┬─────────┘    └──────┬───────┘
         │ chrome.runtime        │                       │
         │ .sendMessage          │                       │
         ▼                       ▼                       │
┌─────────────────────────────────────────┐             │
│           content.js (page)              │  ◄──────────┘
│  - capture (selection / visible / page)  │   chrome.storage.sync
│  - bubble UI + FAB                        │   (apiKey / endpoint /
│  - parseAnswer, showAnswer                │    promptMode / …)
└────────────────────┬────────────────────┘
                     │ chrome.runtime.sendMessage
                     ▼
            ┌──────────────────┐
            │  OpenAI-兼容 LLM │
            │  (user endpoint) │
            └──────────────────┘
```

### 文件树

```
QuizKing/
├─ assets/
│  └─ screenshots/                # README 截图
├─ src/                           # 扩展源码（加载这一层即可运行）
│  ├─ manifest.json               # MV3 manifest
│  ├─ background.js               # service worker：命令路由 / LLM HTTP / 存储
│  ├─ content.js                  # 内容脚本：捕获通道 / 气泡 / FAB
│  ├─ bubble.css                  # 气泡样式
│  ├─ popup.html / popup.js
│  ├─ options.html / options.css / options.js
│  ├─ _locales/zh_CN/messages.json
│  ├─ icons/                      # 16 / 48 / 128 王字 PNG
│  └─ dev/CHECK.md                # 5 分钟手测脚本
├─ .github/
│  ├─ ISSUE_TEMPLATE/             # bug / feature 模板
│  └─ PULL_REQUEST_TEMPLATE.md
docs/                             # 本地开发日志（已在 .gitignore）
├─ .editorconfig
├─ .gitignore
├─ CHANGELOG.md
├─ CODE_OF_CONDUCT.md
├─ CONTRIBUTING.md
├─ FAQ.md
├─ LICENSE
├─ README.md
└─ SECURITY.md
```

## 消息路由

`background.js` 暴露以下 `chrome.runtime.onMessage` 入口：

| type | 行为 | 返回 |
| --- | --- | --- |
| `aqh/get-config` | 读 storage，去 `apiKey` | `{ ok, cfg, hasKey }` |
| `aqh/capture-visible-tab` | `chrome.tabs.captureVisibleTab` | `{ ok, dataUrl }` |
| `aqh/ask` | POST `/chat/completions` + `parseAnswer` + 写历史 | `{ ok, result: { answer, reasoning, raw, promptMode } }` |
| `aqh/test` | 仅探测 storage 状态 | `{ ok, cfg, hasKey }` |
| `aqh/selftest` | 默认关闭，需 `self.__AQH_SELFTEST__ = true` | `{ ok, cfg, routes, flags }` |

> 内部协议命名空间为 `aqh/`（保持稳定，便于第三方工具集成）。

`content.js` 自己处理：

| type | 行为 |
| --- | --- |
| `aqh/capture` | 触发 selection / visible / page / toggle |
| `aqh/close` | 关闭气泡 |
| `aqh/ping` | 探活 |

## 开发

### 本地运行

```bash
# 1. 改 src/ 下的代码
# 2. chrome://extensions/ → QuizKing → ♻ 重新加载
# 3. 普通网页 F12 → console 看 [aqh] 调试日志
# 4. SW DevTools: chrome://extensions → "service worker" 链接 → console
```

### 静态检查

```bash
node --check src/*.js
node -e "JSON.parse(require('fs').readFileSync('src/manifest.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('src/_locales/zh_CN/messages.json','utf8'))"
```

### 调试 Hook

```js
// SW DevTools console
self.__AQH_SELFTEST__ = true;
chrome.runtime.sendMessage({ type: "aqh/selftest" }, console.log);
// → { ok: true, cfg, routes, flags }
```

不依赖 LLM 网络 —— 用于离线核对 wiring 是否就绪。

### 重新生成图标

`src/icons/icon.svg` 是唯一源。生成 16/48/128 PNG：

```bash
NODE_PATH=./_icontools/node_modules node -e "
const sharp = require('sharp');
const fs = require('fs');
const svg = fs.readFileSync('src/icons/icon.svg');
(async () => {
  for (const s of [16, 48, 128]) {
    fs.writeFileSync('src/icons/icon' + s + '.png',
      await sharp(svg, { density: 300 }).resize(s, s).png().toBuffer());
  }
})();
"
```

## FAQ

最常见问题看 [FAQ.md](./FAQ.md)。**先查 FAQ 再开 issue**。

## 隐私与安全

- **API Key** 只存于 `chrome.storage.sync`，永不上报
- **fetch 出站** 只去用户在设置里填的 `endpoint`，**没有**其他任何外发
- **history** 仅写 `chrome.storage.local`，默认保存最近 200 条，可在选项页关闭 / 清空
- **content 脚本**永远拿不到 `apiKey`（`sanitizeCfg` 脱敏后回传）
- **控制台日志** 只输出长度统计 / 通用错误消息，**不含**用户文本或 key
- 安全问题不要开 public issue，按 [SECURITY.md](./SECURITY.md) 流程报告

### Manifest 权限

| 权限 | 用途 |
| --- | --- |
| `storage` | 读 / 写 `chrome.storage.sync` & `.local` |
| `activeTab` | popup 获取当前 tab id |
| `contextMenus` | 注册右键菜单 |
| `scripting` | 截图 / 注入 |
| `notifications` | （预留）错误提示 |
| `host_permissions: <all_urls>` | content 脚本可注入任意页以捕获内容 |

> `host_permissions` 仅用于 content 注入；不出站。

## 路线图

- [ ] 选择 / 判断 / 填空的结构化答案注入
- [ ] 题型 Prompt 模板库（数学 / 编程 / 英语 / 医学）
- [ ] 站点规则：每个域名可独立 prompt + 模型
- [ ] 本地 OCR 引擎（Tesseract.js）作为非视觉模型 fallback
- [ ] Firefox 适配
- [ ] Chrome Web Store 发布

## 贡献

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。要点：

1. Fork & 创建分支
2. `node --check src/*.js` 通过
3. 走一遍 [`src/dev/CHECK.md`](src/dev/CHECK.md)
4. 提 PR，附带：改了什么 / 为什么 / 怎么验证 / 风险点
5. 维护者审 → 合入

行为准则：[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## 作者

[![Bilibili](https://img.shields.io/badge/Bilibili-97727630-00aeec?logo=bilibili&logoColor=white)](https://space.bilibili.com/97727630)

问题反馈 / 合作 / 想看教程 → B 站私信。


## 致谢

- [linux.do](https://linux.do/) — 中文独立技术社区，给了工具 / 思路上的大量启发与反馈

## 许可

[MIT](./LICENSE) — 自由使用、修改、分发。

---

<div align="center">

Made with care for students, self-learners, and anyone staring at quiz screenshots at 2 a.m.

</div>
