---
name: ui-regression-audit
description: >
  OnMyAgent UI regression audit for theme consistency, i18n copy, settings pages,
  and screenshot-based visual checks. Use when scanning UI regressions, verifying
  design-system token usage, checking mixed Chinese/English copy, or producing
  page-by-page visual audit reports.
display_name_zh: "UI 回归巡检"
display_name_en: "UI Regression Audit"
---

# UI Regression Audit

## Goal

Run a repeatable UI regression pass for OnMyAgent / OnMyAgent after visual, copy, settings, or layout changes. The output must include evidence: scan commands, changed files, screenshots when UI behavior changed, and a short pass/fail report.

## Trigger Conditions

Use this skill when the user asks for any of these:

- 全局扫描 UI 问题、主题色、颜色不一致、页面太挤、标题重复、按钮含义不清
- 检查中英文混杂、i18n 文案、设置页文案、页面标题和描述
- 每个页面截图测试、截图巡检、回归报告、修改计划
- 验证某次 UI 调整是否仍然符合 `docs/design/theme-system.md`
- 修复 Settings、sidebar、account menu、model picker、provider auth、composer 等可见 UI
- 用户贴 **Session / 专家 empty / files 侧栏 / 技能矩阵 / composer** 截图抱怨交互或高度（优先 session 清单，不要先扫整站 Settings）

## Inputs And Outputs

| Item | Required Content |
|---|---|
| Input | User request, affected page or screenshot if provided, current repo state. |
| Output | Audit table, concrete fixes, validation commands, screenshot paths when taken. |
| Evidence | `rg` scan output summary, `pnpm task check app`, optional `reports/.../*.png`. |
| State | Update local `.loop/state/PROGRESS.md` only when a local handoff is useful; do not write tracked state docs for routine UI work. |

For non-trivial UI loops, long-running visual sweeps, repeated validation failures, or work that needs durable resumption, read `docs/loop/rules.md` after `AGENTS.md`. Store temporary screenshots, CDP transcripts, and validation evidence under `.loop/evidence/` or ignored report paths; do not add them to tracked `docs/`.

## 🔴 CHECKPOINTS

| Checkpoint | STOP Condition | Required Action |
|---|---|---|
| Scope expansion | Scan finds broad product semantics outside the requested UI area | Stop and classify; do not mass-edit without user approval. |
| Semantic color change | A color encodes error, warning, success, online, diff, chart, file type, or brand identity | Stop and report as “review/keep” unless the user explicitly asks to change it. |
| Data/schema change | Fix requires changing business schema, persisted data, or API contract | Stop and ask user. |
| Screenshot unavailable | UI app or CDP port is not running and user did not ask to start it | Report command to start; do not claim screenshot verification. |
| Repeated failure | Same validation command fails 3 times | Stop, summarize blocker, and ask for direction. |

## Workflow

### 1. Load Project State

Run:

```sh
test -f .loop/state/PROGRESS.md && sed -n '1,220p' .loop/state/PROGRESS.md || true
sed -n '1,220p' docs/design/theme-system.md
```

If either file is missing:

| Failure | Recovery |
|---|---|
| `.loop/state/PROGRESS.md` missing | Continue with repo scan; create no replacement unless a local handoff is useful. |
| `docs/design/theme-system.md` missing | Use existing `dls-*` token usage as the source of truth and note missing doc in the report. |

### 2. Define The Page Inventory

For settings-related work, list available settings pages before editing:

```sh
find apps/app/src/react-app/domains/settings -maxdepth 3 -type f \( -name '*view.tsx' -o -name '*section.tsx' -o -name '*shell*.tsx' \) | sort
```

For broader UI work, inspect routes and common surfaces:

```sh
rg -n "route|settings|sidebar|composer|modal|dialog" apps/app/src/react-app/shell apps/app/src/react-app/domains -g '*.tsx' --no-heading
```

### 2b. Session surface checklist (prefer for session/files/composer PRs)

| Surface | Required check |
|---|---|
| Assistant draft / new task | No agent top header; hero + composer only |
| Expert empty | Prompt cards: readable spacing/height; no metallic gradient hover |
| Composer empty height | Expert matches assistant compact empty height (`homeLayout`) |
| Files side panel | Tree-only until a file is selected; then detail; Office → unavailable not binary dump |
| Skill matrix | Loading shows skeleton/spinner — not “暂无匹配 Skill” |
| Plan mode chip | Icon + label only (no hover ✕) |
| i18n | New strings in **en + zh + zh-TW** |

Boundary: mechanical token/class consolidation → `frontend-primitive-refactor`. This skill owns visual contracts, copy, and evidence.

### 3. Run Theme Token Scan

Use this scan for hard-coded Tailwind color classes that may bypass the design system:

```sh
rg -n "\b(bg|text|border|ring|from|via|to)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-" apps/app/src/react-app apps/app/src/components -g '*.tsx' -g '*.ts' --no-heading
```

Classify every hit before editing:

| Class Type | Decision |
|---|---|
| Selected/current/active/highlight UI | Convert to `dls-accent` token family. |
| Background, border, text neutrals | Convert to `dls-surface`, `dls-border`, `dls-text`, `dls-secondary`, or existing local token. |
| Error/warning/destructive | Keep semantic `dls-status-*` or existing red/amber if no token exists. |
| Success/online/connected | Treat as semantic; change only if user explicitly wants brand-blue status. |
| Diff/chart/file-type/brand/platform color | Keep unless the task specifically targets that component. |

### 4. Run Copy And I18n Scan

```sh
rg -n "[\u4e00-\u9fff].*[A-Za-z]|[A-Za-z].*[\u4e00-\u9fff]|Team|Hub|Provider|Settings|Current|Connected|Connect|Cancel|Save|Delete" apps/app/src/react-app apps/app/src/i18n -g '*.tsx' -g '*.ts' --no-heading
```

Rules:

| Hit | Action |
|---|---|
| User-visible text inside React component | Move to existing i18n system or reuse an existing key. |
| Brand, model ID, provider ID, API term, file extension | Keep as literal. |
| Settings section title | Match existing Chinese terminology and page description style. |
| Duplicate generic page title | Remove the duplicate header; keep the page-specific title. |
| New user-visible string | Update **en + zh + zh-TW** locales together (not en+zh only). |

### 5. Patch With Minimal Diff

Patch only the files required by the audit finding. Prefer existing components and tokens:

| Need | Preferred Token / Component |
|---|---|
| Primary accent | `bg-dls-accent`, `text-dls-accent`, `border-dls-accent/25` |
| Soft accent badge/card | `bg-dls-accent/10`, `text-dls-accent`, `border-dls-accent/20` |
| Text | `text-dls-text`, `text-dls-secondary` |
| Surface | `bg-dls-surface`, `bg-dls-surface-muted`, `bg-dls-hover` |
| Border | `border-dls-border`, `border-dls-border-strong` |
| Danger | `dls-status-danger` token family |

### 6. Validate

Always run focused validation first:

```sh
rg -n "<target-regex>" <changed-files> --no-heading || true
pnpm task check app
```

For long UI token or component-consolidation loops, avoid running Graphify after every tiny patch. Batch related UI-only diffs into a checkpoint, run `git diff --check` and the focused app typecheck for each batch, then run incremental `graphify update .` once at the checkpoint or final handoff. Do not use `graphify update . --force` unless incremental update is explicitly refused by the CLI or a cache anomaly is confirmed; record the reason when `--force` is used.

If UI behavior, layout, or visual state changed, verify with browser/CDP screenshots.

Port checks:

```sh
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:9823 -sTCP:LISTEN
```

Report folder:

```sh
mkdir -p reports/ui-regression-$(date +%Y%m%d-%H%M%S)
```

Screenshot checklist:

| Area | Required Evidence |
|---|---|
| Settings root | Header, duplicate title check, centered layout. |
| Settings subpage | Page-specific title/description, spacing, token usage. |
| Account menu | Selected language/theme indicator and hover state. |
| Model picker | Current model badge, selected row, disabled state. |
| Provider/MCP auth | Connected/disconnected method badges. |
| Sidebar/session list | Active item, status indicator, account footer. |
| Composer | Send/stop button, tool menu, enabled badges, notice state; plan chip without ✕. |
| Assistant draft home | No top agent chrome; composer compact empty height. |
| Expert empty | Prompt cards + composer height vs assistant. |
| Files side panel | Tree-only default; detail after select. |
| Skill matrix | Loading skeleton vs empty copy. |

If screenshot tooling fails:

| Failure | Recovery |
|---|---|
| UI port closed | Start only if user requested startup; otherwise report `pnpm dev`. |
| CDP port closed | Use manual browser screenshot if available; mark CDP evidence missing. |
| Electron-only surface | Structure assert + user screenshot is acceptable evidence; do not claim CDP pass. |
| Page requires state/auth | Capture reachable shell and report missing state requirement. |
| Screenshot script errors | Save DOM/text evidence and include the error. |

### 7. Report

Use this table:

| Area | Result | Evidence | Action |
|---|---|---|---|
| Theme tokens | Pass / Review / Fail | scan count + top files | fixed or classified |
| Copy/i18n | Pass / Review / Fail | scan examples | fixed or deferred |
| Screenshots | Pass / Missing / Fail | report image paths | verified or blocker |
| Typecheck | Pass / Fail | command | fixed or blocker |

End with:

- changed files
- validation commands run
- remaining review items
- whether local `.loop/state/PROGRESS.md` was updated

### 8. Update Progress

For non-trivial work, append one concise note to local `.loop/state/PROGRESS.md` only when handoff value exceeds noise:

```md
- YYYY-MM-DD UI regression: audited theme tokens/copy/screenshots; fixed visible regressions; typecheck passed; remaining items classified as semantic/decorative/product-review.
```

Append current-day validation summaries to `.loop/runs/YYYY-MM-DD.md` only when they help future resumption. Keep tracked state docs such as `docs/LOOP-RUN-LOG.md`, `docs/intent-debt.md`, and `docs/STATE.md` as compatibility pointers, not routine UI audit outputs; `docs/PROGRESS.md` is removed in favor of `.loop/state/PROGRESS.md`.

## Test Prompts

Use these prompts to verify this skill produces useful behavior:

| ID | Prompt | Expected Output |
|---|---|---|
| T1 | “设置页看起来还是不统一，全局扫一下主题色并给我报告。” | Runs state read, token scan, classifies semantic vs theme hits, proposes minimal fixes, includes validation plan. |
| T2 | “每个设置页面截图检查，不要漏，看看标题和中英文有没有问题。” | Builds page inventory, checks i18n/copy, captures or requests screenshot prerequisites, returns page-by-page report. |
| T3 | “这个弹窗的选中态颜色不对，修完怎么验证？” | Locates component, patches token usage, runs focused scan + typecheck, explains screenshot verification path. |

## Anti-Patterns

Do not do these:

| Anti-Pattern | Why It Fails | Correct Behavior |
|---|---|---|
| Mass replacing every color class | Breaks semantic status, charts, file types, and brand identity. | Classify first; edit only requested or clearly wrong UI highlights. |
| Claiming screenshot coverage without images | Gives false confidence. | Provide screenshot paths or state why screenshots were not captured. |
| Editing only one of en / zh / zh-TW | Creates i18n drift. | Update **en + zh + zh-TW** when adding user-visible copy. |
| Ignoring dirty workspace | May overwrite unrelated work. | Inspect `git status --short`; only touch task files. |
| Using npm/yarn | Violates project rules. | Use `pnpm`. |
| Adding new UI primitives unnecessarily | Increases design drift. | Reuse existing components and `dls-*` tokens. |
| Leaving validation vague | Makes regression unrepeatable. | Include exact commands and pass/fail result. |
| Hand-writing tab bars as `inline-flex rounded-lg border p-1` around pill `NavTabButton` | Two shape families in one container (r=10 outer, r=999 inner) reads unbalanced. | Use `<SegmentedTabGroup>` + `<NavTabButton size="tab" shape="tab">` (canonical since manage-page R17 fix). |
| Using `rounded-full` for ordinary CTAs | Only avatars, `NavTabButton` pill chips, `SendButton`, and `architecture-mismatch-gate.tsx` may. | Prefer `rounded-lg` (10) or `rounded-xl` (14) per `DESIGN.md` § 11. |
| Editing signature primitives without checking `components.contracts` | Radius/height/surface drift silently reappears. | Cross-reference the YAML `components.contracts` block in `DESIGN.md` in the same PR. |

## Runtime Neutrality

This skill is runtime-neutral. Do not assume a single agent runtime. If browser automation tools are unavailable, use shell scans and state the missing screenshot capability in the report.
