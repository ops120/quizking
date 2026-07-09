## What

<!-- One-paragraph description of the change. -->

## Why

<!-- Link to issue, motivation, or design note. -->

## How to verify

<!-- Concrete steps a reviewer can run to confirm the change works. -->
1. `chrome://extensions/` → reload AI Quiz Helper.
2. …

## Risk

<!-- What could break? Permission changes? Storage schema changes? LLM contract changes? -->

## Checklist

- [ ] `node --check src/*.js` passes.
- [ ] Manual smoke (划词 / 截图 / 整页) reviewed.
- [ ] No new outbound network call without explicit user setup.
- [ ] No hard-coded secrets.
- [ ] Manifest version unchanged (or bumped with rationale).
