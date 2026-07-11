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

Do not overwrite unrelated dirty files. Write routine loop state only under local `.loop/`. There are no tracked loop stub files under `docs/`.

For non-trivial Loop work, read `docs/loop/rules.md` after `AGENTS.md`.

**Single documentation map:** `docs/README.md`. Expected layout:

```text
docs/
  README.md  Architecture.md  release.md
  loop/rules.md  loop/incidents.md
  design/*  features/*.md
```

## Core Sources Of Truth

| Topic | Source |
| --- | --- |
| Doc map / SoT rules | `docs/README.md` |
| Command surface | root `package.json`, `scripts/cli/*.mjs`, `docs/Architecture.md`, `AGENTS.md` |
| Current local state | `.loop/state/PROGRESS.md` |
| Local validation history | `.loop/runs/YYYY-MM-DD.md` |
| Loop operating rules | `docs/loop/rules.md`, `AGENTS.md` |
| Architecture | `docs/Architecture.md`, `apps/app/src/react-app/ARCHITECTURE.md` |
| Theme and UI docs | `DESIGN.md` (tokens), `docs/design/theme-system.md` (philosophy) |
| Public entry docs | `README.md`, `README-zh.md`, `BUILD.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md` |
| Local packaging | `BUILD.md` |
| Release / tags | `docs/release.md` |
| Package docs | `apps/*/README.md`, `packages/*/README.md` |
| Feature designs | `docs/features/*.md` |
| Project skills | `.codex/skills/*/SKILL.md`, `.opencode/skills/*/SKILL.md` |
| Local execution plans | `.loop/plans/` only |
| Ignored paths | `docs/plans/`, `docs/archive/`, `.loop/*` |
| Skill sync strategy | `references/skills-sync.md` |

## Audit Commands

Run focused scans before editing:

```sh
CORE_DOCS=(
  README.md README-zh.md BUILD.md CONTRIBUTING.md AGENTS.md
  docs/README.md docs/Architecture.md docs/release.md
  docs/loop/rules.md docs/loop/incidents.md docs/features/session-goal.md
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

# Plan ledgers must not be tracked
if git ls-files 'docs/plans/**' 'docs/archive/**' 2>/dev/null | grep -q .; then
  echo 'WARN: tracked plan/archive files found; remove them and keep plans in .loop/plans/'
  git ls-files 'docs/plans/**' 'docs/archive/**'
fi
```

Scan local `.loop/archive/**` only when investigating history.

Compatibility references in tracked pointer docs may be valid when they explicitly describe read-only migration behavior. Classify them before editing.

Execution plans stay in `.loop/plans/` (gitignored). `docs/plans/` and `docs/archive/` are gitignored. Feature **design** contracts may live under `docs/features/`; do not commit plan ledgers there.

## Local Loop State Policy

- `.loop/state/PROGRESS.md` holds current local handoff when needed.
- `.loop/runs/YYYY-MM-DD.md` holds current-day local run history.
- Do not add progress / run-log / plan stubs under `docs/`.
- Feature behavior contracts may live as `docs/features/*.md`.
- Put execution plans and evidence under `.loop/`.

Use a link smoke for core docs:

```sh
python3 - <<'PY'
from pathlib import Path
import re
files = [Path(p) for p in ['README.md','README-zh.md','BUILD.md','CONTRIBUTING.md','AGENTS.md','docs/README.md','docs/Architecture.md','docs/release.md','docs/loop/rules.md','docs/loop/incidents.md','docs/features/session-goal.md','apps/server/README.md','apps/orchestrator/README.md','packages/ui/README.md','packages/handsfree/README.md','apps/app/src/react-app/ARCHITECTURE.md']]
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
- Keep `docs/README.md` as the only full map; do not reintroduce stub pointer files.
- Write routine validation/history to `.loop/runs/YYYY-MM-DD.md`.
- Keep execution plans in `.loop/plans/` only. Never commit `docs/plans/` or `docs/archive/`.
- Update `README.md` and `README-zh.md` together for public capability or roadmap changes.
- Update package README files when root command wrappers supersede package-private commands.
- Do not edit generated/runtime docs under `apps/desktop/dist-electron/**`, `graphify-out/**`, or runtime cache paths.
- Treat bundled skills as product content: `.opencode/skills/**`, `.codex/skills/**`, and `apps/desktop/resources/bundled-skills/**` may intentionally differ. Do not mass-sync them without a product reason.

## Recommended Fix Order

1. Loop rules: load `AGENTS.md` and `docs/loop/rules.md`; keep dynamic state in `.loop/`.
2. Plans cleanup: ensure no tracked files under `docs/plans/` or `docs/archive/`; AI ledgers only in `.loop/plans/`.
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
