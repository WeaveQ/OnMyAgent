---
name: documentation-audit
description: OnMyAgent documentation audit workflow. Use when scanning project docs for stale commands, old branding, broken links, duplicated state, roadmap drift, generated report clutter, local .loop state rules, or when updating README, Architecture, BUILD, AGENTS, loop-rules, package README files, and project Codex/OpenCode skills.
display_name_zh: "文档一致性巡检"
display_name_en: "Documentation Audit"
description_zh: "扫描并修复 OnMyAgent 文档中的旧命令、旧命名、断链、状态文档膨胀和路线图漂移"
description_en: "Audit OnMyAgent docs for stale commands, naming drift, broken links, state bloat, and roadmap drift"
---

# Documentation Audit

## Goal

Keep OnMyAgent documentation accurate, compact, and consistent with the current command surface, runtime boundaries, and loop state model.

## Trigger Conditions

Use this skill when the user asks to:

- 扫描、优化、整理或更新项目文档。
- 检查 README / Architecture / BUILD / AGENTS / docs 状态是否过期。
- 查旧命令、旧品牌、断链、重复文档、生成报告是否该归档。
- 把一次文档审计流程沉淀成项目内 Codex/OpenCode skill。

## Required First Checks

```sh
git status --short --branch
test -f .loop/state/PROGRESS.md && sed -n '1,220p' .loop/state/PROGRESS.md || true
find . -maxdepth 3 -type f \( -name '*.md' -o -name '*.mdx' \) \
  -not -path './node_modules/*' \
  -not -path './apps/desktop/dist-electron/*' \
  -not -path './graphify-out/*' | sort
```

Do not overwrite unrelated dirty files. `docs/PROGRESS.md` has been removed; treat remaining tracked `docs/LOOP-RUN-LOG.md`, `docs/intent-debt.md`, and `docs/STATE.md` as compatibility pointers. Write routine loop state to local `.loop/` files unless the user explicitly asks for a repo doc change.

For non-trivial Loop, durable ledger, graphify, kill-switch, or recovery decisions, read `docs/loop-rules.md` after `AGENTS.md`. This project intentionally keeps routine Loop state in local `.loop/` instead of tracked `docs/` pointer files.

## Core Sources Of Truth

| Topic | Source |
| --- | --- |
| Command surface | root `package.json`, `scripts/cli/*.mjs`, `docs/Architecture.md`, `AGENTS.md` |
| Current local state | `.loop/state/PROGRESS.md` |
| Local validation history | `.loop/runs/YYYY-MM-DD.md` |
| Legacy state pointer | `docs/STATE.md` |
| Loop operating rules | `docs/loop-rules.md`, `AGENTS.md` |
| Architecture | `docs/Architecture.md`, `apps/app/src/react-app/ARCHITECTURE.md` |
| Theme and UI docs | `docs/design/theme-system.md`, `docs/design/ui-primitive-refactor-best-practices.md` |
| Public entry docs | `README.md`, `README-zh.md`, `BUILD.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md` |
| Package docs | `apps/*/README.md`, `packages/*/README.md` |
| Project skills | `.codex/skills/*/SKILL.md`, `.opencode/skills/*/SKILL.md` |
| Local archive | `.loop/archive/` for historical snapshots that should not stay in tracked docs |
| Local execution plans | `.loop/plans/` for temporary plans, execution ledgers, and AI acceptance ledgers |
| Optional tracked plans | `docs/plans/` only when human-facing product or architecture plans are explicitly worth tracking |
| Skill sync strategy | `references/skills-sync.md` |

## Audit Commands

Run focused scans before editing:

```sh
CORE_DOCS=(
  README.md README-zh.md BUILD.md CONTRIBUTING.md AGENTS.md
  docs/README.md docs/Architecture.md docs/STATE.md
  apps/server/README.md apps/orchestrator/README.md
  packages/ui/README.md packages/handsfree/README.md
  apps/app/src/react-app/ARCHITECTURE.md
)

# command drift
rg -n "dev:web|build:web|pnpm --filter @onmyagent/app exec tsc|npm run|yarn |test:i18n|audit:i18n|pnpm build:web|pnpm dev:web" \
  "${CORE_DOCS[@]}" --no-heading || true

# old naming and runtime-state drift
rg -n "\bopenwork\b|\bOpenWork\b|\bTeamWork\b|different-ai/openwork|@openwork|onmyagent-agents|\.opencode/personal-assistant|\.opencode/personal-local-agent" \
  "${CORE_DOCS[@]}" --no-heading || true

# docs by area
printf 'tracked markdown: '; git ls-files '*.md' '*.mdx' | wc -l
git ls-files '*.md' '*.mdx' | awk -F/ '{print $1"/"$2}' | sort | uniq -c | sort -nr | sed -n '1,80p'

# large docs
git ls-files '*.md' '*.mdx' | grep -v '^apps/desktop/dist-electron/' | xargs wc -l | sort -nr | head -n 50

# docs/plans cleanup candidates, only when tracked docs/plans exists
if [ -d docs/plans ]; then
for f in docs/plans/*.md; do
  [ -e "$f" ] || continue
  printf '\n--- %s ---\n' "$f"
  rg -n "^(#|Status:|## Status|## Completion|## Handoff|## Next Required Work)|\[(done|DONE|pending|PARTIAL|BLOCKED)\]" "$f" | sed -n '1,16p' || true
  rg -l "$(basename "$f")|$f" AGENTS.md README.md README-zh.md docs/README.md docs/Architecture.md docs/plans --glob '*.md' | grep -v "^$f$" || true
done
fi
```

Scan local `.loop/archive/**` only when the user asks to investigate historical state. Archived files intentionally contain old command names and legacy paths.

Compatibility references in tracked pointer docs may be valid when they explicitly describe read-only migration behavior. Classify them before editing.

`docs/plans/` is not a run-log or AI execution-ledger sink. Move temporary plans, execution ledgers, one-off reports, and obsolete partial handoffs to local `.loop/plans/` before deleting tracked copies when a handoff backup is useful. Create tracked `docs/plans/` only for human-facing product or architecture plans explicitly worth reviewing in git.

## Local Loop State Policy

- `.loop/state/PROGRESS.md` holds current local handoff when needed.
- `.loop/runs/YYYY-MM-DD.md` holds current-day local run history.
- `docs/PROGRESS.md` has been removed; tracked `docs/LOOP-RUN-LOG.md`, `docs/intent-debt.md`, and `docs/STATE.md` are compatibility pointers, not routine write targets.
- Do not add routine progress, run-log, plan, or archive material under tracked `docs/`; use local `.loop/` instead.
- Put historical snapshots under `.loop/archive/` only when a local backup is useful.
- Put local evidence, screenshots, run transcripts, and temporary audit outputs under `.loop/evidence/` or ignored report paths, not tracked `docs/`.

Use a link smoke for core docs:

```sh
python3 - <<'PY'
from pathlib import Path
import re
files = [Path(p) for p in ['README.md','README-zh.md','BUILD.md','CONTRIBUTING.md','AGENTS.md','docs/README.md','docs/Architecture.md','apps/server/README.md','apps/orchestrator/README.md','packages/ui/README.md','packages/handsfree/README.md','apps/app/src/react-app/ARCHITECTURE.md']]
missing=[]
for f in files:
    if not f.exists():
        continue
    text=f.read_text(errors='ignore')
    for m in re.finditer(r'\[[^\]]+\]\(([^)]+)\)', text):
        target=m.group(1).split('#',1)[0]
        if not target or re.match(r'^[a-z]+:', target) or target.startswith('mailto:'):
            continue
        if not (f.parent/target).resolve().exists():
            missing.append((str(f), text[:m.start()].count('\n')+1, target))
for item in missing:
    print(':'.join(map(str,item)))
print('missing_count', len(missing))
PY
```

## Update Rules

- Prefer updating the source of truth over repeating the same explanation in many documents.
- Keep `.loop/state/PROGRESS.md` short when local handoff is useful.
- Keep `docs/STATE.md`, `docs/intent-debt.md`, and `docs/LOOP-RUN-LOG.md` as legacy pointer pages; `docs/PROGRESS.md` is removed in favor of `.loop/state/PROGRESS.md`.
- Write routine validation/history to `.loop/runs/YYYY-MM-DD.md`; only change repo docs for durable documentation updates.
- Keep execution plans in `.loop/plans/` by default. Before adding tracked `docs/plans/`, confirm it is a human-facing product or architecture plan; after completion, remove or localize unreferenced execution ledgers.
- Update `README.md` and `README-zh.md` together for public capability or roadmap changes.
- Update package README files when root command wrappers supersede package-private commands.
- Do not edit generated/runtime docs under `apps/desktop/dist-electron/**`, `graphify-out/**`, or runtime cache paths.
- Treat bundled skills as product content: `.opencode/skills/**`, `.codex/skills/**`, and `apps/desktop/resources/bundled-skills/**` may intentionally differ. Do not mass-sync them without a product reason.

## Recommended Fix Order

1. Loop rules: load `AGENTS.md` and `docs/loop-rules.md`; keep dynamic state in `.loop/` and tracked state docs as pointers.
2. Plans cleanup: move AI execution ledgers to `.loop/plans/`; prune tracked `docs/plans/` to human-facing product or architecture plans only.
3. Public docs: align `README.md`, `README-zh.md`, `CONTRIBUTING.md`, and `BUILD.md` with current commands and capabilities.
4. Architecture docs: align `docs/Architecture.md` and `apps/app/src/react-app/ARCHITECTURE.md` with actual package boundaries.
5. Package docs: update `apps/*/README.md` and `packages/*/README.md` with root command wrappers and valid links.
6. Skill docs: update only the relevant project skill and explain whether `.codex` / `.opencode` / bundled copies should diverge or be synced.

## Skills Sync Guidance

- Keep bundled desktop skills as real files, not symlinks, unless packaging has been explicitly verified on all targets.
- `.codex/skills/documentation-audit/` and `.opencode/skills/documentation-audit/` should stay synchronized.
- Use `references/skills-sync.md` as the planning source for any future `.agent/skills` source-of-truth migration.
- Do not migrate all bundled skills in a documentation cleanup round unless the user explicitly approves that scope.

## Validation

For doc-only changes run at minimum:

```sh
git diff --check
```

Then run the link smoke above. If command docs changed, also run the smallest relevant command smoke when practical, usually:

```sh
pnpm check
```

If broad architecture docs changed, run:

```sh
graphify update .
```

## Report Format

Return a table:

| Area | Result | Evidence | Action |
| --- | --- | --- | --- |

Include changed files, validation commands, and any intentional remaining stale-looking references such as compatibility terms, external product names, or historical archive content.
