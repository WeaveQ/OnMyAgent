---
name: frontend-primitive-refactor
description: OnMyAgent frontend primitive refactor workflow. Use when editing UI components, aligning same-type component sizes, reducing arbitrary Tailwind classes, migrating repeated button/input/badge/icon/status/loading/code/card patterns into shared primitives, or preventing design-token drift while coding.
display_name_zh: "前端组件复用与尺寸统一"
display_name_en: "Frontend Primitive Refactor"
description_zh: "约束 AI 写 UI 时先复用现有 primitive、统一尺寸、扫描偏移并记录剩余债务"
description_en: "Guide UI coding toward shared primitives, consistent sizes, token-safe styling, scans, and validation evidence"
---

# Frontend Primitive Refactor

## Goal

Keep OnMyAgent UI changes aligned with the design system while coding: reuse shared primitives, standardize same-type component sizes, avoid arbitrary page-level styling, and leave clear evidence for what changed and what intentionally stayed custom.

Use this skill together with `ui-regression-audit` when the task also needs screenshots, i18n checks, or page-by-page visual regression evidence.

## Trigger Conditions

Use this skill when the user asks for any of these:

- 优化前端组件、重构组件、组件复用、统一按钮/输入框/badge/icon/状态点大小。
- 检查 design token、Tailwind arbitrary class、同类组件尺寸不一致。
- 改 Settings、Session、Composer、Sidebar、Modal、Provider/Auth/MCP/Plugin UI。
- 引入或评估组件库时，需要保护 OnMyAgent DLS 不偏移。

## Required First Checks

1. Inspect current dirty state before editing:

```sh
git status --short --branch
```

For non-trivial primitive loops, broad refactors, durable ledgers, graphify decisions, or repeated validation failures, read `docs/loop/rules.md` after `AGENTS.md`. Routine progress and run evidence belong in local `.loop/`, not tracked pointer docs.

2. Read project UI sources of truth when relevant:

```sh
sed -n '1,220p' docs/design/theme-system.md
find apps/app/src/components/ui -maxdepth 1 -type f | sort
```

3. If scope spans multiple modules and the user has not waived it, use graphify before broad edits:

```sh
graphify query "frontend primitive size alignment and design token drift" --budget 1200
```

If `graphify` is unavailable or the user explicitly waived it, continue and note that in the report.

## Classification Before Editing

Classify hits before changing code. Do not mechanically replace raw classes.

| Class | Action |
|---|---|
| Repeated generic button, input, textarea, switch, checkbox | Reuse or extend existing primitive. |
| Repeated badge, count chip, file label, small status label | Use `StatusBadge`, `CountBadge`, or add a narrow variant. |
| Repeated icon/avatar tile | Use `IconTile`; add a size/shape/tone only when repeated. |
| Repeated active/loading/status dot or ping | Use `StatusDot`, `StatusPing`, `LoadingSpinner`. |
| Repeated inline/block mono chip | Use `CodeToken`; keep generated markdown/pre/debug output custom. |
| Repeated notice/help/warning surface | Use `NoticeBox` when content is a simple notice. |
| Brand/logo mark, chart/diff/file-type color, generated HTML, editor field, debug/pre output | Keep custom and explain why. |
| Error/warning/success/online semantic colors | Convert only to existing semantic token/primitives; do not flatten blindly. |
| Raw palette classes | Audit by meaning first; never bulk-replace by color name alone. |

## Refactor Order

Prefer the smallest stable abstraction path:

1. Reuse existing `@/components/ui/*` primitive.
2. Add a focused variant to an existing primitive.
3. For components under `apps/app/src/components/**`, keep them presentational: pass data/actions/render slots as props and move query/store/domain/app-shell logic into a nearby `react-app/**` container.
4. Create a tiny primitive only if the pattern appears in multiple places.
5. Keep custom styling when it encodes brand, semantic status, generated output, or complex editor behavior.

Do not add page-specific arbitrary sizes to solve a local alignment issue. If a new size is needed, add it as a named variant and use it consistently.

## Current OnMyAgent Primitive Map

| Need | Preferred primitive |
|---|---|
| Buttons and icon buttons | `Button` |
| Text inputs | `Input`, `Textarea`, `InputGroup` |
| Tabs/action/list rows | `ActionRowButton`, `SessionRowButton`, related row primitives |
| Icon or avatar tiles | `IconTile` |
| Status and count labels | `StatusBadge`, `CountBadge`, `StepMarker` |
| Dots and live pings | `StatusDot`, `StatusPing` |
| Loading rings | `LoadingSpinner` |
| Inline/block command or code chips | `CodeToken` |
| Notice/help surfaces | `NoticeBox` |
| Multi-tab / segmented panel | `SegmentedTabGroup` + `NavTabButton size="tab" shape="tab"` |
| Composer send affordance | `SendButton` (only `rounded-full` CTA allowed in workbench) |
| Dialog/dropdown/select/tooltip/switch/checkbox | Existing `@/components/ui/*` wrappers |

## Hard Rules

- Do not introduce new `text-[Npx]` arbitrary font sizes.
- Do not introduce raw `bg-blue-*`, `border-gray-*`, `text-zinc-*`, etc. unless classified as semantic/brand/special and reported.
- Do not replace semantic red/amber/green status colors without checking existing status tokens.
- Do not replace brand marks, logo geometry, chart/diff colors, generated markdown HTML, debug/pre/code output, or editable code fields just to reduce scan counts.
- Do not mix unrelated goals in one round. One round should target one component family or one small UI surface.
- Do not claim global completion from a narrow scan; report scope and remaining debt.
- Do not import `@/react-app/*` or relative `react-app/*` modules from `apps/app/src/components/**`; split into a pure view plus a `react-app/**` container instead.
- Do not hand-write `inline-flex rounded-lg border p-1` wrapping default (pill) `NavTabButton` — that was the manage-page shape clash. Use `<SegmentedTabGroup>` + `<NavTabButton size="tab" shape="tab">` instead.
- Do not introduce `rounded-full` on ordinary CTAs. The whitelist is: avatars, `NavTabButton shape="pill"` chip filters, `SendButton`, and the pre-app `architecture-mismatch-gate.tsx`. See `DESIGN.md` § 11.
- When editing a signature primitive (`SettingsCard`, `RailButton`, `SendButton`, `Dialog`, `Input`, `SessionCard`, `ArtifactCard`, `SkillCard`, `ToggleChip`, …), cross-check against `DESIGN.md`'s YAML `components.contracts` block in the same PR.

## Scan Commands

Use the bundled scanner when possible:

```sh
.codex/skills/frontend-primitive-refactor/scripts/ui-primitive-scan.sh .
```

Focused ad hoc scans are also acceptable:

```sh
rg -n '<button[^>]*className=\{?"[^"]*(rounded|px-|py-|h-|w-)' apps/app/src/react-app apps/app/src/components -g '*.tsx' --no-heading
rg -n '<input[^>]*className=\{?"[^"]*(rounded|border|px-|py-|h-)' apps/app/src/react-app apps/app/src/components -g '*.tsx' --no-heading
rg -n '<(span|div)[^>]*className=\{?"[^"]*(rounded-full|rounded-md)[^"]*(px-|size-|text-xs)' apps/app/src/react-app apps/app/src/components -g '*.tsx' --no-heading
rg -n 'text-\[[0-9]+px\]|animate-spin.*rounded-full|rounded-full.*animate-spin|animate-ping' apps/app/src/react-app apps/app/src/components -g '*.tsx' -g '*.ts' --no-heading
```

## Validation Per Round

Minimum validation after edits:

```sh
git diff --check
.codex/skills/frontend-primitive-refactor/scripts/ui-primitive-scan.sh .
```

Add type/build checks when the changed surface warrants it or the user asks:

```sh
pnpm task check app
pnpm task build app
```

If the task touches visual behavior and the app is runnable, use `ui-regression-audit` for screenshots and light/dark verification.

If project rules require graph updates and the user has not waived it, run after code edits:

```sh
graphify update .
```

## Report Format

End each round with:

- Converted: primitives/variants adopted and key files.
- Kept custom: each meaningful remaining raw pattern and why.
- Counts: scanner output before/after or current totals.
- Validation: exact commands and result.
- Next risk: color semantic audit, screenshot check, typecheck/build, or no further action.

## State Updates

For non-trivial UI primitive work, append concise local entries only when a handoff is useful:

- `.loop/state/PROGRESS.md`
- `.loop/runs/YYYY-MM-DD.md`

Put temporary screenshots, scan transcripts, and validation artifacts under `.loop/evidence/` or ignored report paths. Never commit generated `graphify-out/**`, screenshot reports, runtime cache, or tracked `docs/LOOP-RUN-LOG.md` / `docs/intent-debt.md` routine updates unless the user explicitly asks.
