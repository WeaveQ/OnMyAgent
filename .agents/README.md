# Project Agent Skills

Cross-harness skill catalog for OnMyAgent coding agents (Grok, Claude Code, Codex, etc.).

## Layout (LobeHub-style)

```text
.agents/skills/<name>/SKILL.md   ← source of truth (edit here only)

.codex/skills  → ../.agents/skills   (symlink)
.claude/skills → ../.agents/skills   (symlink)
.grok/skills   → ../.agents/skills   (symlink)
```

Do **not** create a second copy under `.codex/`, `.claude/`, or `.grok/`.  
Do **not** add `.cursor/` in this repo (not used).

Desktop **product** skills stay in `apps/desktop/resources/bundled-skills/` as real files (packaging).  
OpenCode product/workspace config stays under `.opencode/` (not a mirror of this tree).

## When to add a skill

| Put in a skill | Put in `AGENTS.md` instead |
| --- | --- |
| Multi-step workflow (audit, refactor, review) | Iron laws, path allow/deny, default commands |
| Domain playbook with scripts/references | One-line “read X first” pointers |
| Trigger phrases for auto-invocation | Always-on project rules |

## Adding a skill

1. Create `.agents/skills/<kebab-name>/SKILL.md`.
2. Required frontmatter: `name`, `description` (when to use).
3. Optional: `user-invocable`, `disable-model-invocation`, `display_name_zh` / `display_name_en`.
4. Keep the body actionable; link to `docs/` for durable architecture.
5. Symlinks already cover Codex / Claude / Grok — no extra copy.
6. Update the skill index in root `AGENTS.md`.

## Catalog (current)

| Skill | Use when |
| --- | --- |
| `documentation-audit` | Stale docs, old commands, broken links, doc map drift |
| `ui-regression-audit` | Theme / i18n / screenshot UI regression |
| `frontend-primitive-refactor` | Primitive reuse, size/token consistency while coding UI |
| `self-improving` | Capture learnings / corrections (external-style self-improve pack) |
| `self-improving-agent` | Log errors/learnings into `.learnings/` |
| `skills-audit` | Audit this catalog for overlap / stale skills |

## Maintenance

- Edit only under `.agents/skills/`.
- Periodic: run the `skills-audit` skill (or its checklist).
- Windows: enable Developer Mode or use admin privilege so git symlinks work; otherwise clone may materialize plain text link files.
