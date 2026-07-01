# Legacy Loop State

`docs/STATE.md` is a historical compatibility entrypoint only. Do not append new work here.

## Current Sources

| Need | Source |
| --- | --- |
| Current local handoff | `.loop/state/PROGRESS.md` |
| Current-day run log and validation evidence | `.loop/runs/YYYY-MM-DD.md` |
| Local intent debt and ambiguous instructions | `.loop/state/intent-debt.md` |
| Severe repo-wide, unsafe, production, or cost-risk incidents | `docs/loop-incidents.md` |

New sessions should read local `.loop/state/PROGRESS.md` first when it exists, then inspect `.loop/runs/` when current-day validation detail is needed. Tracked `docs/LOOP-RUN-LOG.md`, `docs/intent-debt.md`, and this file are compatibility pointers only; `docs/PROGRESS.md` was removed after progress moved to local `.loop/state/PROGRESS.md`. Older repo progress snapshots and run logs were moved to local `.loop/archive/` and should not receive new routine loop entries.
