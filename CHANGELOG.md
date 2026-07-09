# Changelog

All notable changes to QuizKing · 答题王 are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Changed
- Brand rename: `AI Quiz Helper` → `QuizKing · 答题王`. Internal protocol namespace `aqh/*` is preserved for stability.
- Icon: solid blue square with white 王 glyph.

### Documentation
- New top-level files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `FAQ.md`.
- README expanded with Quick Start, FAQ link, Contributing link, manifest permission table, file tree.

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

[Unreleased]: https://example.com/ai-quiz-helper/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/ai-quiz-helper/releases/tag/v0.1.0
