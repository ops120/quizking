# QuizKing Ultimate · 答题王终极版

> Chrome MV3 扩展：检测题目 → LLM 推理 → 自动点击 → **不交卷**
> 融合三项目精华：**QuizKing**（Chrome 扩展 + 多模型并行）+ **interface-assistant**（EduSoho DOM 解析 + 自动点击）+ **AFB**（交卷拦截护栏）

[![Manifest V3](https://img.shields.io/badge/manifest-V3-3563ff)](#)
[![Chrome 114+](https://img.shields.io/badge/chrome-114%2B-4285f4)](#)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-4%20suites%20green-3ddc84)](#测试)

---

## 能力概览

| 功能 | 快捷键 | 说明 |
|------|--------|------|
| 🔍 **检测题目** | — | 只识别页面结构与可作答性，**不调 LLM、不点击**，先确认页面是否支持 |
| 🚀 **自动检测题目并作答** | `Ctrl+Shift+F` | 解析页面所有题目 → 分批并行 LLM 推理 → 自动点击（**不交卷**） |
| 🧩 **通用题目识别** | 自动 | 五路信号合并（容器 / 字母选项组 / radio·ARIA / 文本作答框 / 分节标题），不依赖特定站点类名 |
| 📚 **参考资料作答** | 自动 | 导入本地 Markdown 当知识库，每题检索相关段落注入 prompt，答案有据可查 |
| 🖐 **对照模式** | 可选 | 每题并列「资料原文」与「LLM 答案」，**都不自动填**，点选才执行 |
| 🩹 **失败自动降级** | 自动 | 点击/推理失败的题，答案直接标在题旁 + 生成「需手动处理」清单，可一键定位 |
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

**推荐流程**：先「🔍 检测题目」确认可作答 → 再「🤖 自动答题」。检测气泡会告诉你题目数与可自动点击的题数；**每路识别策略各命中几题**记录在诊断日志里，点「📋 复制诊断日志」即可整段拷走。

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

### 📚 参考资料（可选）

设置页 →「📚 参考资料」，把 Markdown 文件拖进去即可。作用是**让答案有出处**，而不是让模型凭记忆猜。

| 设置 | 默认值 | 说明 |
|------|--------|------|
| 启用参考资料 | 开 | 没有导入文档时此项零影响 |
| 对照模式 | 关 | 见下方「对照模式」 |
| 资料没覆盖题目时 | `prefer` | `prefer` = 用资料；资料没写就按通用知识答。`strict` = 资料没写就答「资料未涉及」，不凭记忆 |
| 每题引用段落数 | 4 | 检索 topK |
| 注入字数上限 | 2400 | 控制 token 成本；资料总量不超过它时直接全文注入，绕开漏召回 |

容量上限：单文档 60 万字、总资料 240 万字（存 `chrome.storage.local`）。

**导入的 md 怎么排更容易被检索到**：用 `##` 分节、每题/每条独立成段并用空行隔开。切块规则是「攒到约 360 字再遇空行才切」，所以一题一段天然形成 300–500 字/块——正好是检索的舒适区。仓库根目录 `samples/小学语文100题.md` 是一份按此格式排好的示例，可直接导入。

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
> **失败时会弹出「诊断信息」气泡**，包含 LLM 配置状态、快照详情、批量响应原文、逐题解析结果，以及**每种识别策略各命中几题**，便于定位问题。

### 以参考资料作答

导入 md 后自动生效，无需额外操作。每道题独立检索，query 是「题干 + 选项文本」。

诊断日志里会有一行 `📚 引用资料 N/M 题`：

- **N 接近 M** → 检索正常
- **N 明显偏小** → 资料没覆盖这些题，或题干用词与资料差异太大（见「已知限制」）

气泡里同时标注了每段资料的**文件名 + 章节名**，可逐字核对模型有没有编。

### 对照模式

开启后每题下方出现一张卡片：

```
第 7 题 · 两个答案，你来定            待选择
📚 本地资料原文（BM25 命中 2 段）
  ▾ 小学语文100题.md · 六、古诗文积累
      **59.** 补全「欲穷千里目，（　）」。**答：更上一层楼。**
🤖 LLM 答案
  B
  解析 ▸
[ 采用 LLM 答案 ]  [ 都不对 ]
```

- **本地一侧严格原样**：不抽答案、不总结、不改写，只做截断和标注出处。要判断真伪就得能逐字核对原文。
- **两个都不自动填**。点「采用 LLM 答案」才执行点击；点「都不对」卡片转红、进「需手动处理」清单。
- **推理失败也出卡片**：模型没答案时资料原文才是唯一线索，此时卡片只展示资料 + 报错，不给「采用」按钮。
- 资料状态分**四种**说法，不混为一谈：`命中原文` / `参考资料未启用` / `本次未检索资料` / `本地资料未命中`。

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
┌──────────────────────────────────────────────────────────┐
│  Chrome MV3 Extension                                    │
├──────────────────────────────────────────────────────────┤
│  content.js          页面注入 → 检测题目 → 编排 → 执行    │
│  ├─ quiz-snapshot    五路信号合并识别题目                 │
│  ├─ answer-executor  点击/填空执行 + 结果验证             │
│  ├─ answer-badge     行内徽标 + 对照模式卡片              │
│  ├─ manual-queue     需人工处理队列（纯逻辑）             │
│  └─ highlight        高亮遮罩 + 虚拟光标 + 消息面板       │
├──────────────────────────────────────────────────────────┤
│  background.js       service worker：LLM 并行扇出 + 检索  │
│  ├─ askAll()         多 provider 并行 + 多数投票          │
│  ├─ injectRefs()     检索资料并前置到 prompt              │
│  └─ refs.js          BM25 索引 / 切块 / 检索（纯函数）    │
├──────────────────────────────────────────────────────────┤
│  popup / options     工具栏 popup / 设置页                │
└──────────────────────────────────────────────────────────┘
```

### 自动答题数据流

```
用户按 Ctrl+Shift+F
  → content.js 触发 autoAnswer()
    → QuizSnapshot.takeSnapshot()           ← 五路信号合并识别全部题目

    分批循环（每批 autoBatch 题）：
    ┌─ [Q1..Q5] → callBg('aqh/auto-answer-batch')
    │   → background: 逐题 injectRefs()（检索资料，前置进 prompt）
    │   → 5题 × N个provider 并行推理 → 多数投票
    │   → 返回 answers[]（含 optionIndex + reasoning + localRefs）
    │
    │   → 逐题处理（串行，避免UI冲突）：
    │       对照模式 → 渲染卡片，等用户点选
    │       普通模式   → highlight → click → verify → sleep
    └─ 下一批…

    → 失败的题标答案 + 进「需手动处理」清单
    → 检测提交按钮 → 警告但不点击 ← 交卷拦截
```

---

## 技术细节

### 题目识别（quiz-snapshot.js）

不赌单一选择器。**五路信号并行采集，再按文档序合并**，任一路命中即可：

| 策略 | 适用场景 |
|------|----------|
| 容器级 | 有 per-question 容器（`.question` / `.ibs-engine-item` / 通用 class 打分） |
| 字母选项组 | 自绘选项（`<i>A</i>` 圆形字母标），无原生 radio、无容器 class（如 jutiku） |
| radio / ARIA 分组 | 平铺输入框，按 `input[name]` 或 `role="radio"` 分组切题 |
| 文本作答框 | `textarea` / `contenteditable` / 文本 input（自动排除登录、搜索、验证码框） |
| 分节标题 | 「一、单选题」「二、多选题」这类标题，用来校正整段的题型 |

合并后按 `compareDocumentPosition` 重排文档顺序，重打 `data-qku-q` 锚点。

几个踩过的坑，代码里都有对应处理：

- 字母必须是**独立子元素**或紧跟标点，否则题干 `His parents` 会被误判成「选项 H」
- 字母组必须**严格递进**（A→B→C，容忍跳 2），否则会跨题串扰
- **不能按锚点去重**：平铺结构下多题共用同一祖先锚点是正常的，去重会把 3 题合并成 1 题
- `body` / `documentElement` **不打锚点**，否则第 1 题的徽标永远插不上
- 题型判定顺序：分节标题 → 标签文字（多选/判断/填空/简答）→ checkbox 数量 → radio 数量 → 可编辑元素

题型映射：`single_choice` / `multi_choice` / `true_false` / `fill_blank` / `short_answer`。
同源 iframe 由顶层 frame 经 `targetDoc` 统一编排；跨域 iframe 由 iframe 内自行作答。

### 本地检索（refs.js）

**不是向量检索**，是纯手写的 **BM25（Okapi BM25）**，单文件约 250 行，零依赖、零网络、零费用。

```
切块   chunkMarkdown()  按 ## 分节、空行分段；攒到 maxLen*0.6 再遇空行才切
分词   tokenize()       中文用字符二元组（计算机网络 → 计算/算机/机网/网络），英文数字走正则
索引   buildIndex()     每块预计算 tf / df / 块长 / avgLen，全在内存
打分   search()         score = Σ idf(t)·tf·(k1+1) / (tf + k1·(1−b+b·d/avgLen))
                        k1=1.2, b=0.75（Elasticsearch 默认值）
注入   injectRefs()     每题单独检索，命中段落包成「<资料N｜文件名 · 章节>」前置进 prompt
```

召回有三道闸：必须命中 ≥2 个不同词、分数低于最高分 35% 的块丢弃、topK + 累计字数封顶。

不用分词器库的原因：JS 端中文分词库动辄几百 KB，塞进 service worker 不划算；bigram 不需要词典、召回高，精度损失由 idf 压住。

### 推理（background.js）

- `aqh/auto-answer`：单题推理，返回 `{ optionIndex, reasoning }`
- `aqh/auto-answer-batch`：批量推理，`Promise.all(questions.map(...))` 并行
- 多 provider **并行扇出** → **多数投票**（对归一化后的答案计数取众数）
- 答案解析：字母优先，失败则按选项文本模糊匹配；多选支持 `"A,C"` 和 `"AC"`（自动去重）

### 执行与验证（answer-executor.js）

- 单选/判断：`el.click()` → **验证选中态**（`checked` / `aria-checked` / 祖先 class）→ 未生效则补发完整事件序列（`mousedown`/`mouseup`/`click` + `PointerEvent`，兼容 React/Vue/Angular）→ 再验证
- 多选：逐个处理，返回「是否全部子选项成功」
- 填空/简答：**限定在题目容器内**找输入框（早期版本会错误地填到全页第一个框），支持 `contenteditable`（写 `textContent` + input 事件 + 光标置尾）
- 支持传入 `doc` 参数，在 iframe 文档内定位与点击

> 返回 `true` 表示**真的选中了**，不是「`click()` 没抛异常」。

### 失败降级

自动点击或推理失败的题不会被静默跳过：

1. 答案用 `forceFill` 标在题旁（无视行内徽标开关）
2. 记入「需手动处理（N 题）」清单，点题号可滚动定位 + 高亮
3. 整批失败时也会给这一批补上错误标记，不留「推理中」的假状态

### 安全

- API Key 仅存于 `chrome.storage.sync`，`aqh/get-config` 下发前会剔除密钥与内部配置键
- 提交/交卷按钮**只检测不点击**
- 所有外部注入文本均经 `escapeHtml()` 转义
- 对照卡片的按钮 `preventDefault + stopPropagation`，避免点按钮时冒泡点到页面选项

---

## 测试

零浏览器、零网络的本地回归，改完先跑这个再同步扩展：

```bash
npm install        # 首次：jsdom
npm test           # 4 个套件：71 条断言 + 61 题识别回归（基线对比，漂移即失败）
```

| 套件 | 内容 |
|------|------|
| `tests/run.mjs` | 识别回归：6 个真实/构造页面共 61 题，与 `tests/baseline.json` 基线对比题数与题型序列，**任何漂移退出码 1**。有意改动识别逻辑后跑 `node tests/run.mjs --update` 刷新基线 |
| `tests/refs.test.mjs` | BM25 切块、分词、检索、注入提示词（19 条断言） |
| `tests/manual-queue.test.mjs` | 需人工队列的去重/移除/排序/脏数据（21 条断言） |
| `tests/dual.test.mjs` | 对照卡片渲染、按钮回调、四种资料状态、推理失败态（31 条断言） |

`tests/fixtures/` 放页面快照。`jutiku-real.html` 取自真实试卷页（133 KB、46 题），入库前已脱敏：CSRF token 与 `data-userpaper` 账号记录号都换成了固定假值，见 `tests/fixtures/README.md`。重新抓取快照时记得再脱敏一遍。

---

## 调试

```bash
node --check src/*.js          # 语法检查
npm test                       # 本地回归
```

`chrome://extensions/` → QuizKing Ultimate → ♻ 重新加载（改代码后必须重载，只刷新页面无效；**改了 manifest 也必须重载**）

- **页面日志**：F12 → Console → `[qku]`（content）/ `[executor]` / `[snapshot]`
- **后台日志**：`chrome://extensions` → 「检查视图 Service Worker」→ `[qku-bg]`（含 `[refs]` 检索命中详情）
- **失败诊断**：自动答题有失败时会直接弹出「诊断信息」气泡，点「📋 复制诊断日志」可整段拷走
- **真实页面分析**：`node tests/analyze-jutiku.mjs` 通过 CDP 连到已登录的 Chrome，在真实试卷页上直接跑识别并打印结果；跑完会把当前 DOM 覆盖写入 `tests/fixtures/jutiku-real.html`（记得脱敏，见 `tests/fixtures/README.md`）。前置条件是 Chrome 带 `--remote-debugging-port=9222` 启动——Windows 可直接跑仓库根的 `start-debug-chrome.bat`，它起的是 `C:\ChromeDebug` 独立实例，**不会动你日常用的 Chrome**

---

## 开发

扩展运行时零依赖（`package.json` 里的 `jsdom` / `playwright-core` 只是本地测试脚手架的 devDependencies，不参与扩展打包），无构建步骤，直接改 `src/` 后重载扩展即可。

脚本注入顺序（`manifest.json` 的 `content_scripts`）：

```
quiz-snapshot → highlight → answer-executor → answer-badge → manual-queue → content
```

`manual-queue.js` 必须在 `content.js` 之前；缺失时会降级为「清单功能不可用」并在诊断里报错，答题主流程不受影响。

`refs.js` 是 ES module，只被 `background.js` import，同时也被 `tests/refs.test.mjs` 直接 import——所以它保持纯函数、零浏览器 API。

---

## 已知限制

- **BM25 是词法检索，换个说法就不命中。** 问「哪首诗写了月亮」召不回「床前明月光」。当前对「照资料答题」够用（题干与资料用词高度重合）；要补可加同义词表，或接 embedding 做混合检索。
- **平铺结构下多题共用锚点**：题干与选项完全同层、没有 per-question 容器时，只有最后一题能拿到锚点，对照卡片只能插一个。真实 jutiku 页面是 46 题 46 锚点，不受影响。
- 多选题答案若模型返回空数组，会走到"点击未生效"的降级路径。

---

MIT · 基于 [QuizKing](https://github.com/ops120/quizking) 构建
