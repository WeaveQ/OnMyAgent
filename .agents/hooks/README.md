# Agent PreToolUse hooks

Single implementation for Claude Code, Cursor, and Codex. Harness config files only invoke this script.

| Gate | Blocks | Override |
| --- | --- | --- |
| Denylist | Read/write `.env*`, `secrets/**`. Hand-edit `node_modules/**`, `graphify-out/**` | None for secrets. `pnpm task graphify` may write `graphify-out/` |
| Human gate | Write `package.json`, `pnpm-lock.yaml`, `apps/server/src/**`, `apps/desktop/electron/**`, `apps/orchestrator/src/**`. Package install/update (lockfile) | After the user explicitly approves: `ONMYAGENT_ALLOW_HUMAN_GATE=1` |
| Test lock | Write existing test/spec files | Off by default. On when `ONMYAGENT_LOCK_TEST_EDITS=1` or `.loop/state/lock-tests` exists |

Reads of Human-gate source stay allowed so agents can study the code. Secrets stay out of context.

## Wiring

| Harness | Config | Flag |
| --- | --- | --- |
| Claude Code | `.claude/settings.json` | `--format=claude` |
| Cursor | `.cursor/hooks.json` | `--format=cursor` |
| Codex | `.codex/hooks.json` | `--format=codex` |

Do not copy this script into `.claude/hooks` or `.cursor/hooks`.

## Verify

```bash
node --test .agents/hooks/pretooluse.test.mjs
```
