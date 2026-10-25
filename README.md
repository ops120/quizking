# QuizKing Ultimate · 答题王终极版

> Chrome MV3 扩展：检测题目 → LLM 推理 → 自动点击 → **不交卷**
> 融合三项目精华：**QuizKing**（Chrome 扩展 + 多模型并行）+ **interface-assistant**（EduSoho DOM 解析 + 自动点击）+ **AFB**（交卷拦截护栏）

[![Manifest V3](https://img.shields.io/badge/manifest-V3-3563ff)](#)
[![Chrome 114+](https://img.shields.io/badge/chrome-114%2B-4285f4)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

---

## 能力概览

| 功能 | 快捷键 | 说明 |
|------|--------|------|
| 🔍 **检测题目** | — | 只识别页面结构与可作答性，**不调 LLM、不点击**，先确认页面是否支持 |
| 🚀 **自动检测题目并作答** | `Ctrl+Shift+F` | 解析页面所有题目 → 分批并行 LLM 推理 → 自动点击（**不交卷**） |
| 📝 选区文本问AI | `Ctrl+Shift+Q` | 选中文字后一键问AI |
| 📸 截图框选问AI | `Ctrl+Shift+E` | 框选屏幕区域截图，发送给多模态LLM |
| 🧠 多模型并行推理 | 自动 | 同时调用多个LLM，**多数投票**取最佳答案 |
| ⚡ 批量并行 | 可配置 | 每批 N 题同时推理 |
| ✨ 视觉反馈 | 自动 | 橙色高亮框 + 虚拟光标 + 右下角面板直播（可关闭） |
| 💬 行内答案徽标 | 可选 | 在每题下方直接显示答案与解析，popup「答案显隐」随时收起 |
| 🔒 交卷拦截 | 自动 | 检测提交/交卷按钮，**绝不点击**，仅提示手动确认 |
| 📋 历史记录 | 自动 | 最近 200 条问答，可查看/清空 |

**触发方式**：快捷键 / 右键菜单 / 工具栏 popup / 页面右下角浮动「王」按钮

> **快捷键没反应？** 快捷键若被系统或其他扩展占用，Chrome 会静默丢弃命令——本扩展内置了页面级兜底监听（`Ctrl+Shift+Q/E/F/H`），正常情况下仍可触发。若仍无效，去 `chrome://extensions/shortcuts` 重新绑定即可。

**推荐流程**：先「🔍 检测题目」确认可作答 → 再「🤖 自动答题」。检测会告诉你题目数、题型分布、可自动点击的题数，以及 LLM 服务商是否配置好。

---

## 安装

```bash
# 1. 打开 Chrome 扩展管理页
chrome://extensions/

# 2. 右上角打开「开发者模式」

# 3. 点「加载已解压的扩展程序」→ 选择 quizking-ultimate/src/ 目录

# 4. 工具栏出现「王」字蓝色图标 → 安装成功
```

---

## 配置（必做）

首次使用**必须**在选项页填入自己的 LLM 服务商，否则自动答题会全部失败：

右键工具栏「王」图标 → 「设置」→ 「＋ 添加服务商」

| 字段 | 说明 | 示例 |
|------|------|------|
| 名称 | 自定义标签 | `DeepSeek` |
| Endpoint | **OpenAI 兼容** API 地址 | `https://api.openai.com/v1` |
| API Key | 密钥（仅存于 `chrome.storage.sync`，content script 永不获取） | `sk-...` |
| Model | 模型名 | `gpt-4o-mini` |
| 启用 | 开关，可临时停用 | |

> 任何兼容 OpenAI `/chat/completions` 协议的服务商都可以，不限定厂商。
> 支持**多服务商并行**：启用多个后每次答题同时调用，答案并列展示 + 一致性徽章。
> 单次请求 45s 超时，单个失败不影响其余。

### 其他设置

| 设置 | 默认值 | 说明 |
|------|--------|------|
| 批量答题数 | 5 | 每批并行推理的题目数（1=逐题，30=一次30题） |
| 每题延迟 | 300ms | 点击间隔 |
| Temperature | 0.1 | LLM 推理温度 |
| 气泡透明度 | 0.95 | 气泡外观 |
| Prompt 模式 | 答案+解析 | 可切换自定义 prompt |
| 静默模式 | 关 | 开启后不弹气泡，进度只推到 popup 状态栏 |
| 保存历史 | 开 | 最近 200 条 |
| 视觉特效 | 开 | 高亮框/虚拟光标/消息面板；关闭后答题照常，只是没有动画 |
| 行内答案徽标 | 关 | 在每题下方显示答案与解析，不影响自动点击 |

---

## 使用

### 自动答题（核心功能）

1. 打开题库页面（EduSoho / 通用选择题页面均可）
2. 按 **`Ctrl+Shift+F`** 或 popup「🤖 自动答题」
3. 观察高亮框 + 虚拟光标动画，每批并行推理 → 逐题点击
4. 气泡面板显示实时进度和最终报告
5. 检测到提交按钮时弹出警告，**不自动点击**
6. 自行检查后手动交卷

> **运行中可随时暂停/继续**：popup「⏸ 暂停/继续」。
> **失败时会弹出「诊断信息」气泡**，包含 LLM 配置状态、快照详情、批量响应原文、逐题解析结果，便于定位问题。

### 手动问答

| 操作 | 快捷键 |
|------|--------|
| 选中文字 → 问AI | `Ctrl+Shift+Q` |
| 框选截图 → 问AI | `Ctrl+Shift+E` |
| 显示/隐藏气泡 | `Ctrl+Shift+H` |
| 召唤「王」浮动按钮 | popup「王 按钮」 |

**禁复制页面**（禁止选中文字/右键）可用框选截图，或在气泡内「上传图片」选本地图片。

---

## 架构

```
┌──────────────────────────────────────────────────────┐
│  Chrome MV3 Extension                                │
├──────────────────────────────────────────────────────┤
│  content.js         页面注入 → 检测题目 → 执行点击    │
│  ├─ quiz-snapshot   DOM 题目解析（EduSoho + 通用）    │
│  ├─ answer-executor 自动点击/填空执行器                │
│  ├─ answer-badge    行内答案徽标（可选开关）           │
│  └─ highlight       高亮遮罩 + 虚拟光标 + 消息面板     │
├──────────────────────────────────────────────────────┤
│  background.js      service worker：LLM 并行扇出      │
│  ├─ askAll()        多 provider 同时调用 + 多数投票    │
│  ├─ auto-answer     单题推理                           │
│  └─ auto-answer-batch 批量并行推理（每批N题）          │
├──────────────────────────────────────────────────────┤
│  popup / options    工具栏 popup / 设置页              │
└──────────────────────────────────────────────────────┘
```

### 自动答题数据流

```
用户按 Ctrl+Shift+F
  → content.js 触发 autoAnswer()
    → QuizSnapshot.takeSnapshot()           ← 检测页面所有题目

    分批循环（每批 autoBatch 题）：
    ┌─ [Q1..Q5] → callBg('aqh/auto-answer-batch')
    │   → background: 5题 × N个provider 并行推理
    │   → 多数投票取每题最佳答案
    │   → 返回 answers[] (含 optionIndex + reasoning)
    │
    │   → 逐题点击（串行，避免UI冲突）：
    │       Q1: highlight → click → sleep
    │       Q2: highlight → click → sleep
    │       ...
    └─ 下一批…

    → 检测提交按钮 → 警告但不点击 ← 交卷拦截
```

---

## 技术细节

### 题目检测（quiz-snapshot.js）

1. **EduSoho 优先**：检测 `.ibs-engine-item` → 解析 `.answer-mode-tag`、`.ibs-stem`、`label.ibs-choose-item`
2. **打标记防撞车**：`data-qa-index` / `data-qa-opt` 确保选择器全局唯一
3. **题型映射**：单选/多选/判断/填空/简答；`材料题` → `multi_choice`
4. **通用兜底 · radio 分组切题**：题目被 JS 渲染进同一容器、没有 per-question 类名时，按 `input[name]` 分组切分（每组互斥 radio 即一题），题干用 TreeWalker 排除选项元素后取最短祖先
5. **iframe 支持**：同源 iframe 由顶层 frame 经 `targetDoc` 统一编排；跨域 iframe 由 iframe 内自行作答

### 推理（background.js）

- `aqh/auto-answer`：单题推理，返回 `{ optionIndex, reasoning }`
- `aqh/auto-answer-batch`：批量推理，`Promise.all(questions.map(...))` 并行调用
- 多 provider **并行扇出** → **多数投票**取最佳
- 答案解析：字母优先，失败则按选项文本模糊匹配；多选支持 `"A,C"` 和 `"AC"` 两种格式（自动去重）

### 执行（answer-executor.js）

- 单选/判断：`el.click()` → 失败降级为完整事件序列（`MouseEvent` + `PointerEvent`，兼容 React/Vue/Angular）
- 多选：逐个 click
- 填空/简答：`input.value = text` + `dispatchEvent`
- 支持传入 `doc` 参数，在 iframe 文档内定位与点击

### 安全

- API Key 仅存于 `chrome.storage.sync`，`aqh/get-config` 下发前会剔除密钥与内部配置键
- 提交/交卷按钮**只检测不点击**
- 所有外部注入文本均经 `escapeHtml()` 转义

---

## 调试

```bash
node --check src/*.js          # 语法检查
```

`chrome://extensions/` → QuizKing Ultimate → ♻ 重新加载（改代码后必须重载，只刷新页面无效）

- **页面日志**：F12 → Console → `[qku]`（content）/ `[executor]` / `[snapshot]`
- **后台日志**：`chrome://extensions` → 「检查视图 Service Worker」→ `[qku-bg]`
- **失败诊断**：自动答题有失败时会直接弹出「诊断信息」气泡，不必翻控制台

---

## 开发

零依赖，无构建步骤，直接改 `src/` 后重载扩展即可。

---

MIT · 基于 [QuizKing](https://github.com/ops120/quizking) 构建
