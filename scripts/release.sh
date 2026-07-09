#!/usr/bin/env bash
# QuizKing · 答题王 — initial release script
# Run from the repo root on a host with git + GitHub auth (gh / SSH key / PAT).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# --- 1. Sanity check ---
test -f "src/manifest.json" || { echo "✗ src/manifest.json missing"; exit 1; }
test -f "README.md" || { echo "✗ README.md missing"; exit 1; }
test -f "LICENSE" || { echo "✗ LICENSE missing"; exit 1; }
test -d "assets/screenshots" || { echo "✗ assets/screenshots missing"; exit 1; }

# --- 2. git init if needed ---
if [ ! -d ".git" ]; then
  git init -b main
  echo "✓ git init (main branch)"
else
  echo "• .git already exists, skipping init"
fi

# --- 3. ensure user.name / user.email (use global if missing here) ---
GIT_NAME="$(git config --global --get user.name 2>/dev/null || true)"
GIT_EMAIL="$(git config --global --get user.email 2>/dev/null || true)"
if [ -n "$GIT_NAME" ]; then git config user.name "$GIT_NAME"; fi
if [ -n "$GIT_EMAIL" ]; then git config user.email "$GIT_EMAIL"; fi
echo "• git user: $(git config --get user.name) <$(git config --get user.email)>"

# --- 4. add + commit ---
git add .
git status --short
echo "---"
git commit -m "Initial commit: QuizKing · 答题王 v0.1.0

- MV3 Chrome / Edge extension
- Three capture modes: selection / visible (with crop) / page DOM
- OpenAI-compatible LLM endpoint
- Three prompt modes: answer / answer+reasoning / custom
- Draggable, opacity-adjustable floating bubble with 王 glyph
- Triggers: keyboard shortcuts, context menu, FAB, popup
- Local history (last 200), dirty-state guard on options page
- Zero telemetry, API key never leaves the background worker
- MIT licensed; see CONTRIBUTING.md / CODE_OF_CONDUCT.md / SECURITY.md / FAQ.md"

echo "✓ initial commit created"

# --- 5. remote + push ---
REMOTE="https://github.com/ops120/quizking.git"
if git remote get-url origin >/dev/null 2>&1; then
  echo "• origin already set: $(git remote get-url origin)"
else
  git remote add origin "$REMOTE"
  echo "✓ remote origin -> $REMOTE"
fi

# Create the empty GitHub repo first (do this on github.com UI or via gh CLI),
# then run this script's last block manually:
#
#   gh repo create ops120/quizking --public --source=. --remote=origin --push
#       # or if it already exists empty:
#   git push -u origin main
#
# Recommended GitHub repo metadata (paste into the About / Description box):
#   Description: 划词 / 截图 / 抓取 → LLM 答题，Chrome 扩展，零上报
#   Website:      (leave blank)
#   Topics:       chrome-extension, manifest-v3, llm, openai, openai-compatible,
#                 quiz, ocr-screenshot, floating-bubble, prompt-engineering
