# Legacy Loop Pointers

Compatibility page only. **Do not append routine loop work here.**

## Write locations (current)

| Need | Path |
| --- | --- |
| Current local handoff | `.loop/state/PROGRESS.md` |
| Current-day run log and validation evidence | `.loop/runs/YYYY-MM-DD.md` |
| Local intent debt | `.loop/state/intent-debt.md` |
| Temporary AI execution plans | `.loop/plans/` |
| Local historical snapshots | `.loop/archive/` |
| Severe repo-wide / unsafe / production / cost-risk incidents | [`loop-incidents.md`](loop-incidents.md) |

## Old tracked paths

These files remain as short redirects so old bookmarks and agent memory still resolve:

| Old path | Meaning |
| --- | --- |
| `docs/STATE.md` | Was global state; now pointer only |
| `docs/intent-debt.md` | Was intent debt log; now pointer only |
| `docs/LOOP-RUN-LOG.md` | Was run log; now pointer only |
| `docs/PROGRESS.md` | Removed; use `.loop/state/PROGRESS.md` |

## Policy

- Promote durable rules to `../AGENTS.md`, `loop-rules.md`, or the relevant project skill.
- Promote durable architecture to `Architecture.md` or `apps/app/src/react-app/ARCHITECTURE.md`.
- Keep ordinary TODOs, smoke output, and screenshots in `.loop/`.
