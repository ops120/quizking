# Changelog

All notable changes to QuizKing · 答题王 are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Documentation
- README 使用 section gained a 「快捷键没反应？」 troubleshooting note: rebind the command in `chrome://extensions/shortcuts` (Chrome silently skips default keys taken by other extensions), with a walkthrough screenshot.

## [0.2.0] - 2026-09-06

> Author: <https://space.bilibili.com/97727630>
> Thanks: <https://linux.do/>

### Added
- Three capture modes: text selection, full-page text, visible-region screenshot.
- OpenAI-compatible LLM endpoint with default `gpt-4o-mini` and per-call image+text.
- Customisable system prompt with three modes: answer-only, answer+reasoning, custom.
- Draggable, opacity-adjustable floating bubble.
- Triggers: keyboard shortcuts (configurable), right-click context menu, FAB, popup.
- Per-page in-place cropping for screenshot mode.
- Local history (last 200, opt-in) and one-click clear.
- Self-test hook (`aqh/selftest`) gated behind `self.__AQH_SELFTEST__` for offline wiring checks.
- Default blue-square icon with a 王 glyph (simplified Chinese for "king").
- Dirty-state indicator on the options page: any field edit highlights `● 有未保存的修改` until 保存 is clicked. `beforeunload` warns on dirty tab close.
- Detailed keyboard descriptions in `chrome://extensions/shortcuts` (used to say only "抓取当前选区"; now spells out what each command does and when to use it).
- Low-opacity blending: below 0.8 the bubble progressively desaturates, the title row (王 glyph + "QuizKing · 答题王") fades out completely, and other saturated accents (primary buttons) fade faster than the bubble itself, so at the 0.4 floor it blends into the page instead of leaving coloured hotspots.

### Changed
- Brand rename: `AI Quiz Helper` → `QuizKing · 答题王`. Internal protocol namespace `aqh/*` is preserved for stability.
- Icon: solid blue square with white 王 glyph.
- **Removed "只要答案" prompt mode.** The default is now "答案 + 解析" only. Users with the old `promptMode: "answer"` setting are auto-migrated to `reason` on next load. `parseAnswer` regex is now tolerant of whitespace and prose-wrapped JSON.
- **Marked `Ctrl+Shift+P` (抓取整页 DOM 文本) as experimental.** Long pages can spike token use and latency. Popup button, manifest command description, and README all show a ⚠ badge.

### Fixed
- `parseAnswer` no longer mistakes the first line of a model's scratchpad for the answer when the model returns JSON wrapped in prose or a `<think>` block.
- The options page restores the saved `bubbleOpacity` and `saveHistory` on load (previously the slider always showed the default and saving any other setting silently reset them), and an open bubble live-applies opacity changes via `chrome.storage.onChanged`.

### Documentation
- New top-level files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `FAQ.md`.
- README expanded with Quick Start, FAQ link, Contributing link, manifest permission table, file tree.
- README gained a 气泡透明度 subsection with before/after screenshots of the low-opacity page-blending behaviour.

### Security
- API key stored in `chrome.storage.sync` only; never sent to content scripts (sanitised cfg).
- No third-party analytics, telemetry, or beacon.

## [0.1.0] - 2026-07-09

### Added
- Initial release.
- Manifest V3 service worker.
- Options page, popup, FAB, bubble UI.
- Three capture channels wired to a single LLM call.
- i18n via `_locales/zh_CN/messages.json` (extension name + description).
- Icons (16/48/128) generated from a single SVG.
- README screenshots under `assets/screenshots/`: install / config / shortcuts.

[Unreleased]: https://github.com/ops120/quizking/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ops120/quizking/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ops120/quizking/releases/tag/v0.1.0
