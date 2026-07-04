# UI Primitive Refactor Best Practices

This document defines how AI agents should change OnMyAgent UI without drifting from the design system.

> **Read [`DESIGN.md`](../../DESIGN.md) first.** It is the authoritative visual contract (tokens, components, Do's / Don'ts). This file explains the *refactor workflow* that keeps code aligned with `DESIGN.md`.

## Intent

OnMyAgent UI work should improve consistency without turning pages into one-off Tailwind compositions. AI agents must reuse existing primitives, align same-type component sizes, classify special visuals before editing, and provide validation evidence.

## Default Workflow

1. Inspect current dirty state with `git status --short --branch`.
2. Read the relevant primitive files in `apps/app/src/components/ui/` before editing.
3. Run `.codex/skills/frontend-primitive-refactor/scripts/ui-primitive-scan.sh .` for baseline counts when the task is broad.
4. Classify hits as convert, keep, or review.
5. Change one component family or one small UI surface per round.
6. Validate with `git diff --check` and focused scans.
7. Use screenshot regression for visible layout/theme changes.
8. Record non-trivial UI primitive work in local `.loop/state/PROGRESS.md` and `.loop/runs/YYYY-MM-DD.md` only when handoff value exceeds noise.

## Primitive Priority

| Need | Preferred primitive |
|---|---|
| Button or icon button | `Button` |
| Text input | `Input`, `Textarea`, `InputGroup` |
| Action tab/list row | `ActionRowButton`, `SessionRowButton`, related row primitives |
| Multi-tab / segmented panel | `SegmentedTabGroup` + `NavTabButton size="tab" shape="tab"` — never hand-write `inline-flex rounded-lg border p-1` around default (pill) `NavTabButton` |
| Composer send affordance | `SendButton` — the only `rounded-full` CTA allowed inside workbench chrome |
| Icon/avatar tile | `IconTile` |
| Status/count badge | `StatusBadge`, `CountBadge`, `StepMarker` |
| Status dot/ping/loading | `StatusDot`, `StatusPing`, `LoadingSpinner` |
| Command/path/code chip | `CodeToken` |
| Notice/help/warning surface | `NoticeBox` |
| Dialog/dropdown/select/tooltip/switch/checkbox | Existing `@/components/ui/*` wrappers |

## Component Contracts (machine-readable)

For every signature/primitive edited, cross-check the target shape
against `DESIGN.md`'s YAML `components.contracts` block. Radius,
height, surface, and padding must match the `{token.ref}` values there
before the PR merges. Repeated mismatches earn a codemod rule in
`scripts/design/codemod/`.

## Refactor Decision Order

1. Reuse an existing primitive and variant.
2. Add a focused variant to an existing primitive.
3. Create a small primitive only for repeated patterns.
4. Keep custom styling when it is special-purpose and document why.

## Keep Custom

Do not force these into generic primitives just to lower scan counts:

- Brand or logo geometry.
- Chart, diff, file-type, provider, or platform colors.
- Error, warning, success, online, and destructive semantic colors unless an equivalent semantic token exists.
- Markdown-rendered HTML, generated content, pre/debug output, command logs, or editable code fields.
- Complex editors, file inputs, table cell editors, and layout-specific overlays.

## Hard Guardrails

- Do not add `text-[Npx]` arbitrary font sizes.
- Do not add new raw palette classes unless the semantic reason is documented.
- Do not use shadows to create hierarchy unless the user explicitly asks.
- Do not claim a global UI cleanup from a narrow scan.
- Do not commit `graphify-out/**`, screenshot reports, or runtime cache as part of UI cleanup.

## Validation Evidence

A UI primitive refactor report must include:

| Evidence | Required content |
|---|---|
| Converted | Which primitives/variants were adopted. |
| Kept custom | Which remaining patterns stayed custom and why. |
| Counts | Scanner output or focused before/after counts. |
| Commands | `git diff --check`, focused `rg`, typecheck/build/screenshots when applicable. |
| Risk | Dark/light mode, i18n, layout, semantic color, or no notable risk. |

## Ant Design Policy

Ant Design may be used as a low-level implementation for complex table/form/tree/date/upload surfaces, but business code should continue importing project-owned `@/components/ui/*` wrappers. Do not migrate the app wholesale to antd, and do not replace DLS primitives such as `Button`, `StatusBadge`, `IconTile`, or chat/session controls without a separate RFC.
