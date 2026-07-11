# Skills Sync Strategy

OnMyAgent engineering skills use a **single source tree** plus tool-specific symlinks (same idea as LobeHub’s `.agents/skills`).

| Location | Role | Expectation |
| --- | --- | --- |
| `.agents/skills/` | **Source of truth** for repo coding-agent skills | Edit here only |
| `.codex/skills` | Symlink → `../.agents/skills` | Codex discovery |
| `.claude/skills` | Symlink → `../.agents/skills` | Claude Code discovery |
| `.grok/skills` | Symlink → `../.agents/skills` | Grok discovery |
| `.opencode/` | Product / workspace OpenCode config (not a full skill mirror) | Keep separate |
| `apps/desktop/resources/bundled-skills/` | Skills shipped inside the desktop app | **Real files only** (no symlinks) |

## Rules

1. Never maintain a second edited copy of the same engineering skill under `.codex/`, `.claude/`, or `.grok/`.
2. Do not symlink `apps/desktop/resources/bundled-skills/**`; packaging must see real files.
3. Do not put temporary plans under `.agents/`; use local `.loop/plans/`.
4. This repo does not use `.cursor/` for skills.

## Validation

```sh
# Source inventory
find -L .agents/skills -name SKILL.md | sort

# Symlinks resolve
readlink .codex/skills .claude/skills .grok/skills

# Same SKILL.md through every link
test -f .agents/skills/documentation-audit/SKILL.md
test -f .codex/skills/documentation-audit/SKILL.md
test -f .claude/skills/documentation-audit/SKILL.md
test -f .grok/skills/documentation-audit/SKILL.md
```
