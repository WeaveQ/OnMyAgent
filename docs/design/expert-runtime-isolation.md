# Expert session runtime isolation

| Field | Value |
| --- | --- |
| Status | **Active** — first landing |
| Date | 2026-08-10 |
| Branch | `fix/expert-runtime-isolation` |

## Problem

Expert sessions only injected persona via `system` while OpenCode still:

1. Defaulted to **Sisyphus - ultraworker** (home `oh-my-openagent` plugin) when `promptAsync.agent` was unset.
2. Scanned **global skill trees** (`~/.claude`, `~/.agents`, profile skills), bloating first-turn input to ~**100k** tokens.

## Approach (path A, first cut)

| Layer | Behavior |
| --- | --- |
| Session directory | Write `opencode.json` with `default_agent: onmyagent`, `plugin: []` |
| Skills | Copy **only** declared skill names from profile/`OPENCODE_GLOBAL_SKILLS_DIR` into `<session>/.opencode/skills/` |
| Prompt | Expert / bound-expert turns force `agent` via `resolveExpertPromptAgent` (never Sisyphus) |
| Marker | `isolationVersion`, `defaultAgent`, `installedSkills` on `onmyagent-session.json` |

## Known limits

- Shared `opencode serve` may still **read** `~/.opencode/opencode.json` for process-level plugins. Project `plugin: []` + **forced agent** is the reliable Sisyphus block; full HOME sandbox is path B if dogfood still shows global skill dumps.
- `OPENCODE_GLOBAL_SKILLS_DIR` remains process-wide; isolation is by **not** dumping the catalog into the expert agent context (light agent) and by session-local skill folders for `load_skill`.

## Acceptance

- New expert assistant message: `agent` is `onmyagent` (or other non-Sisyphus).
- First-turn input tokens for 达人运营-class experts target **&lt;10k** (soft **&lt;15k** if system prompt is long).
- Unit: materialize skills + resolveExpertPromptAgent.

## Follow-ups

- Path B: session-scoped HOME if home plugins still inflate context after this cut.
- Optional: register package agent name as OpenCode agent file under the session dir.
