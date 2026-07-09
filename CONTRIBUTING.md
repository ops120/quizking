# Contributing to QuizKing · 答题王

感谢你愿意花时间改进 QuizKing。本指南让你 5 分钟内进入开发节奏。

## 行为准则

请阅读并遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 提 Issue

- **Bug**：用 `.github/ISSUE_TEMPLATE/bug_report.md` 模板。
- **功能请求**：用 `.github/ISSUE_TEMPLATE/feature_request.md` 模板。
- **安全问题**：**不要**开公开 issue，按 [SECURITY.md](./SECURITY.md) 流程私下报告。

## 提 Pull Request

1. **Fork** 仓库并创建分支：`git checkout -b feat/your-feature`
2. 写代码。**最小改动**、**单一职责**、**与现有风格保持一致**。
3. **本地验证**（见下）
4. **提 PR**，填 `.github/PULL_REQUEST_TEMPLATE.md`，说明：
   - 改了什么 / 为什么
   - 怎么验证（含截图 / 日志）
   - 风险点（权限变动 / 存储 schema / LLM 协议）

## 本地验证

```bash
# 1. 静态检查
node --check src/*.js
node -e "JSON.parse(require('fs').readFileSync('src/manifest.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('src/_locales/zh_CN/messages.json','utf8'))"

# 2. 浏览器加载
# chrome://extensions/ → 开发者模式 → 加载已解压 → 选 src/

# 3. 手测
# 划段文字 → Ctrl+Shift+Q → 看到答案
# 截图 → Ctrl+Shift+E → 拖框 → 看到答案
# 整页 → Ctrl+Shift+P → 看到答案
# 切 Prompt 模式 → 点保存 → 状态栏「✓ 已保存」
# 详细：[src/dev/CHECK.md](src/dev/CHECK.md)
```

## 代码规范

- 缩进：**2 空格**
- 行宽：**≤ 100 字符**
- 引号：**双引号** `"`
- 末尾换行：**有**（`\n`）
- 文件首：`/** @license MIT — QuizKing · 答题王 xxx */`
- 命名：camelCase 变量 / PascalCase 类
- 消息协议：`aqh/xxx`（保持稳定）
- DOM 注入：`id="aqh-*"` / `.aqh-*`（保持稳定）

## 提交规范

Conventional Commits（推荐）：

```
feat: 加选择题自动注入答案
fix: 修截图框选 edge case
docs: 改 README 快捷键说明
chore: 升级 sharp 到 0.34
refactor: 抽 pickRectOnPage 到独立模块
test: 加 promptMode 切换单测
```

## 项目结构

```
src/
  manifest.json          # 必读：先看这里
  background.js          # service worker
  content.js             # 内容脚本 + 气泡
  bubble.css             # 气泡样式
  popup.{html,js}        # 工具栏 popup
  options.{html,css,js}  # 选项页
  _locales/zh_CN/messages.json
  icons/                 # 16/48/128 王字图标
  dev/CHECK.md           # 5 分钟手测脚本
docs/                    # 本地开发日志（已在 .gitignore）
.github/
  ISSUE_TEMPLATE/        # bug / feature
  PULL_REQUEST_TEMPLATE.md
```

## 设计原则

1. **零上报** —— 不加任何外发
2. **API Key 不进 content** —— 始终在 background 持有
3. **协议稳定** —— `aqh/*` 消息、DOM ID、storage schema 改动要先讨论
4. **MIT 兼容** —— 不要引入 GPL / 商业组件
5. **每个 PR 一件事** —— 不要夹带无关 refactor

## 版本发布

维护者负责，流程：

1. 更新 `CHANGELOG.md` 中 `[Unreleased]` → 实际版本号
2. `git tag v0.x.y`
3. 构建并上传 Chrome Web Store（如已开通）
4. GitHub Release 写一段摘要

## 联系方式

- B 站：<https://space.bilibili.com/97727630>
- [linux.do](https://linux.do/)：社区讨论 / 想法交流
- GitHub Issues：仅功能 / bug / 讨论
- 安全问题：见 [SECURITY.md](./SECURITY.md)

— QuizKing maintainers
