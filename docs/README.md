# Documentation Index

This directory contains durable OnMyAgent project documentation. Keep transient runtime output and generated reports out of `docs/` unless they are intentionally curated.

## Entry Points

| Document | Purpose |
| --- | --- |
| `../README.md` | Public project overview, quick start, architecture summary, and contribution guide. |
| `../README-zh.md` | Simplified Chinese project overview, quick start, architecture summary, and contribution guide. |
| `../AGENTS.md` | Agent/Loop operating manual and repository rules. |
| `../DESIGN.md` | Authoritative visual contract for tokens, components, Do's / Don'ts. Machine-readable YAML front matter for AI agents plus narrative for humans. |
| `Architecture.md` | System architecture, package boundaries, command surface, data flow, and test gates. |
| `loop-rules.md` | Detailed Loop, durable ledger, kill switch, Reference Parity, and graphify rules. |
| `../BUILD.md` | Desktop packaging and release build runbook. |
| `../SECURITY.md` | Vulnerability reporting, security scope, and safe harbor. |
| `../CODE_OF_CONDUCT.md` | Community behavior expectations and reporting path. |

## Directory Map

| Area | Path | Contents |
| --- | --- | --- |
| Architecture | `Architecture.md` | Durable architecture and command-surface source of truth. |
| Loop rules | `loop-rules.md` | Detailed operating rules loaded from `../AGENTS.md` for non-trivial loop work. |
| Design | `../DESIGN.md`, `design/` | `../DESIGN.md` at repo root is the authoritative visual contract; `design/` holds design-philosophy narrative and UI primitive refactor best practices. |
| Design tooling | `../scripts/design/` | Local scripts backing the design contract. `extract-tokens.mjs` diffs `DESIGN.md` YAML against code-side token sources; invoke via `pnpm task check design`. |
| Optional tracked plans | `plans/` when present | Human-reviewable product or architecture plans only; AI execution ledgers belong in `.loop/plans/`. |
| Local loop state | `.loop/state/`, `.loop/runs/`, `.loop/plans/` | Local-only progress, run logs, intent debt, evidence, and execution ledgers. |
| Incident log | `loop-incidents.md` | Severe repo-wide, unsafe, production, or cost-risk incidents only. |
| Local archive | `.loop/archive/` | Local-only historical snapshots and superseded AI run docs. |
| Skill strategy | `../.codex/skills/documentation-audit/references/skills-sync.md` | Source-of-truth and sync policy for Codex/OpenCode/bundled skills. |

## State Rules

- Read `.loop/state/PROGRESS.md` for current local handoff when it exists.
- Append current-day validation history to `.loop/runs/YYYY-MM-DD.md`.
- Put temporary execution plans and durable ledgers in `.loop/plans/` unless the user explicitly asks for a tracked product or architecture plan.
- Keep remaining tracked state docs such as `LOOP-RUN-LOG.md`, `intent-debt.md`, and `STATE.md` as compatibility pointers only.
- Keep `loop-incidents.md` for severe incidents only; ordinary TODOs, local failures, and routine validation notes stay in `.loop/`.
- Do not add routine progress, run-log, plan, or archive material to tracked `docs/`; use local `.loop/` instead.

## Maintenance Rules

- Keep root-level public docs limited to entry points: `../README.md`, `../README-zh.md`, `../BUILD.md`, `../SECURITY.md`, `../CODE_OF_CONDUCT.md`, `../LICENSE`, and repository governance files.
- Put reusable design rules under `docs/design/`.
- Create `docs/plans/` only for durable human-facing product or architecture plans; keep AI execution plans under `.loop/plans/`.
- Put documentation and skill synchronization strategy in `../.codex/skills/documentation-audit/references/skills-sync.md` rather than repeating it in every skill.
- When command names change, update `../AGENTS.md`, `../README.md`, `../README-zh.md`, `../BUILD.md`, `Architecture.md`, and relevant package README files together.
