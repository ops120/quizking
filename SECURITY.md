# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

**Please do NOT open a public issue for security problems.**

私下报告（任何一种即可）：

- B 站私信：<https://space.bilibili.com/97727630>
- 邮件主题加 `[QuizKing security]`

报告应包含：

1. 问题描述与潜在影响
2. 复现步骤
3. 受影响版本（commit hash 或版本号）
4. 你的环境（浏览器版本 / OS）
5. 是否已自行修复 / workaround

## Response Timeline

| 阶段 | 承诺时间 |
| --- | --- |
| 首次确认 | 7 天内 |
| 评估严重度 | 14 天内 |
| 修复发布 | 视严重度：critical 7 天 / high 30 天 / medium 90 天 |

## Threat Model

QuizKing 把用户填的 OpenAI 兼容 endpoint / API key 存在 `chrome.storage.sync`。
`apiKey` 永远只在 `background.js` 服务工作线程里使用，从不传给 content script。

潜在威胁：

- 攻击者通过恶意网页读取 content script DOM — 我们的 `sanitizeCfg` 显式剥离 `apiKey`
- 攻击者通过修改 content script 拦截 prompt — 截图与划词完全在用户触发下进行，UI 自检
- 攻击者替换用户 endpoint — 用户可随时在选项页改回

不在范围内（已声明）：

- 用户电脑被攻陷 → 攻击者能直接读 `chrome.storage.sync`
- 用户主动把 API Key 填进钓鱼网站

## Security Audit Log

- 2026-07-09：首次静态审计。无硬编码密钥 / 无第三方上报 / 仅出站到用户配置 endpoint
