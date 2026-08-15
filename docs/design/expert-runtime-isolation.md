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
| Agent file | Lean `.opencode/agents/onmyagent.md` so default_agent always resolves (v2) |
| Skills | Copy **only** declared skill names from profile / `OPENCODE_GLOBAL_SKILLS_DIR` / legacy into `<session>/.opencode/skills/` |
| Prompt | Expert / bound-expert turns force `agent` via `resolveExpertPromptAgent` (never Sisyphus) |
| Lazy ensure | `POST .../expert-session-isolation` upgrades old dirs before next prompt |
| Marker | `isolationVersion` (current **2**), `defaultAgent`, `installedSkills` on `onmyagent-session.json` |

## Path B — OpenCode process HOME sandbox (landed)

Desktop `buildChildEnv` prepares `userData/opencode-sandbox/` and sets
`HOME` + `XDG_*` for the managed OpenCode/server children:

- Mirrors **providers only** (and `auth.json`) from the real user home
- Forces `plugin: []` (no oh-my-openagent / Sisyphus)
- Empty of `~/.claude` / `~/.agents` skill trees

Opt-out for debugging: `ONMYAGENT_OPENCODE_USE_REAL_HOME=1`.

### Dogfood numbers (2026-08-10)

| Setup | agent | first-turn input |
| --- | --- | --- |
| Real HOME + force onmyagent | onmyagent | ~78k |
| Real HOME default | Sisyphus | ~90k (or cache-masked) |
| **Sandbox HOME + onmyagent + full kol expert system** | **onmyagent** | **~4.8k** |

## Acceptance

- New expert assistant message: `agent` is `onmyagent` (or other non-Sisyphus).
- First-turn input tokens for 达人运营-class experts target **&lt;10k** (soft **&lt;15k** if system prompt is long).
- Unit: materialize skills + agent file + ensure upgrade + resolveExpertPromptAgent + sandbox config strip.

## Related

- Expert **UI** lifecycle (tabs / draft / cold-open): [`expert-surface-architecture.md`](./expert-surface-architecture.md)
- Monorepo pointers: [`../Architecture.md`](../Architecture.md) Session / Expert section

## Follow-ups

- Optional: register package agent name as OpenCode agent file under the session dir.
- **Landed:** shared OpenCode child does **not** inherit the server's profile
  `OPENCODE_GLOBAL_SKILLS_DIR`. Expert turns only see skills copied into
  `<session>/.opencode/skills`. A dedicated expert process can pass
  `expertSessionDirectory` so the env points at that materialized dir.
- Product sidecar pins `OPENCODE_CONFIG_DIR` + computer-use overlay to the sandbox config dir (does not inherit `~/.config/opencode`). Passwd-home scan of `~/.claude` / `~/.agents` still needs a binary-side block if it remains after this pin.
