# React App Architecture (`src/react-app/`)

This document captures the domain-based layout for the React runtime in
`apps/app`. React is the sole UI runtime; the previous Solid runtime and its
migration shims have been removed.

Monorepo-level architecture, command surface, and package boundaries live in
`docs/Architecture.md`. This file is the source of truth for UI domains only.

## Top-level layout

```text
src/react-app/
├── shell/                     App bootstrap, providers, route frames (orchestration only)
│   ├── session-route/         Session host facade folder (index + render + intent/composer/…)
│   ├── settings-route/        Settings host (render + model + actions facade)
│   ├── boot-state / loading-overlay   Progressive boot latch + full-screen overlay
│   ├── route-load-registry / load-surface   Unified route/page load scopes + chrome
│   ├── session-memory         Local prefs + cold-start sidebar session cache
│   └── app-root / providers   Route tree composition
├── kernel/                    App-wide state + provider contracts
│   └── user-error.ts          Product-facing error templates + classify helpers
├── infra/                     React-only runtime infra (e.g. QueryClient)
├── capabilities/              Cross-domain application capabilities with neutral ownership
│   ├── artifacts/             Markdown, Office preview, open-target and artifact contracts
│   ├── conversation/          Dual-runtime timeline / item VM (OpenCode + Personal → one UI shape)
│   ├── layout/                Session content-column / transcript layout contracts (pure helpers)
│   ├── model-selection/       Shared model picker modal + select container + hidden-model state
│   ├── session-identity/      Session/workspace identity persistence shared by domains
│   ├── account-avatar/        Account avatar prefs + user avatar chip
│   └── context-usage/         Session context-window usage model
├── design-system/             Product composites (ConfirmModal, SelectMenu, LabeledInput, …)
└── domains/                   Feature-scoped code, one folder per product domain
    ├── session/               Live conversation runtime (transcript, composer, sync, goal)
    │   ├── pages/              Host pages; Expert surface FSM (`expert-surface-machine.ts`,
    │   │                        `expert-surface-mode.ts`, `use-expert-route-lifecycle.ts`)
    │   ├── chat/               Session host pages + light panels (personal host re-exports)
    │   ├── surface/           Transcript, composer, plan-goal helpers, markdown
    │   ├── sync/              Session state plumbing
    │   ├── components/        Session-local UI (permission modal, status bar, side-panel pages, …)
    │   ├── sidebar/           Rail, conversation lists, chrome barrel (session-chrome.ts)
    │   │                        main rail bottom: channels + devices icons
    │   ├── artifacts/ status/ navigation/ control/ hooks/
    │   ├── browser/ infinite-canvas/
    │   └── modals/
    ├── local-agents/          ACP / local agent editors, cards, agent-management, personal host
    ├── task-center/           Durable cross-agent workflow list/detail/actions via Desktop IPC
    ├── messaging/             Automations + Feishu/Weixin channel panels
    ├── agents/                Agent registry UI + personal agent pages
    ├── plugins/               Skills/plugins/connectors + expert/skills marketplace
    ├── workspace/             Create + share + rename + workspace files
    ├── settings/              Settings shell + tab bodies under pages/ (incl. global Updates,
    │                            `state/ai-providers-controller.ts` for AI tab load/merge UX)
    ├── knowledge/             Local Markdown vault (rail page + CodeMirror editor)
    ├── connections/           MCP + provider auth (canonical owner);
    │                            `merge-connected-providers.ts` shared inventory merge
    ├── cloud/                 Den auth + restrictions + org onboarding
    ├── shell-feedback/        Reload banner, toasts, top-right notifications
    └── shared/                Cross-domain infra only (see below)
```

**`domains/plugins/`** owns the skills/plugins UI implementation (`plugins-page.tsx`,
`skills-catalog.ts`, `skill-scope.ts`, `bundled-skill-locale.ts`, and artifact plugin
install/detail surfaces). Import via `domains/plugins` barrel.

**`domains/local-agents/`** ships a domain-level `index.ts` barrel. Session host pages
and re-exports import via the barrel; local-agents has no reverse dependency on session.

Atoms live outside this tree: `apps/app/src/components/ui/*` (see `DESIGN.md` § 4 / § 4i).

## Why domains

Domain ownership gives every feature one obvious home.

- `session/` owns the **live conversation runtime** (surface, sync, composer, goal
  lifecycle) on the **OpenCode primary path** (HTTP/SSE/archive). It must not re-absorb
  agent management or messaging channels.
  Composer attachments (including **Appshot** desktop capture) live under
  `domains/session/surface/composer/`; Appshot is macOS-only and talks to the
  desktop bridge (`captureComputerUseAppshot` / `computerUse.onAppshot`). Multi-skill
  slash chips are Lexical token nodes in `composer/editor.tsx`.
- `local-agents/` owns the **Personal Local Agent auxiliary path** (desktop CLI/ACP
  harness UI): local/ACP agent edit, cards, messages UI, `agent-management/` pages,
  and the personal host under `host/`. Not the product main session engine—see
  monorepo `docs/Architecture.md` **Dual Runtime Boundary**.
  Public exports (`AgentBrandIcon`, recent-workspace helpers, …) go through
  `domains/local-agents/index.ts` for other domains.
- `task-center/` owns the neutral multi-agent workflow UI. Task/Run/Turn truth remains
  in the detached desktop `task-supervisor` and its SQLite-backed Task Orchestrator;
  Electron main is only the reconnecting bridge. The renderer uses typed Desktop IPC +
  TanStack Query and must not call Personal worker APIs or persist a duplicate workflow
  store.
- `messaging/` owns automation pages and messaging channel panels (Feishu, Weixin, pairing).
  Automation session records are exported from `domains/messaging/index.ts`.
- `agents/` owns registry-facing agent pages and selection UX.
- `plugins/` owns skills catalog and plugins/connectors pages.
- `workspace/` owns every workspace-modal flow and workspace files page.
- `settings/` owns settings state, shell, and tab bodies under `pages/`.
- `knowledge/` owns the local Markdown vault rail page and editor. Session hosts
  it through the public barrel (open-rail via `subscribeOpenKnowledgeNote` /
  `openKnowledgeNoteInRail`). Knowledge must not import session.
- `connections/` owns MCP and provider auth UI (**canonical**).
- `cloud/` owns organization and Den authentication flows.
- `shell-feedback/` owns reload banners, status toasts, and top-right notification chrome.
- `shared/` is **infra only** (env/extension/desktop-config/server-store + thin re-exports).
  Product features must not land here.

Cross-domain imports must be declared by `scripts/checks/domain-boundary-policy.mjs`
and go through the target public entrypoint (`domains/<name>/index.ts`). Undeclared
dependency directions fail `pnpm check:boundaries`. The file-level
`allowedDomainImports` table in `scripts/checks/check-boundaries.mjs` is **empty**
(cleared residual whitelist; reserved/docs-only, shrink-only — never grow). New code
must not add to it. Reusable application behavior belongs in `capabilities/`, while
reusable product composites belong in `design-system/`.

## Data flow

```text
┌────────────────────────────────────────────────────────────┐
│                     src/index.react.tsx                    │  React entry
└────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│  react-app/shell/providers.tsx (AppProviders composition)  │
│   ServerProvider                                           │
│   └─ GlobalSDKProvider                                     │
│      └─ GlobalSyncProvider                                 │
│         └─ LocalProvider                                   │
│            └─ (QueryClientProvider + PlatformProvider      │
│               wrap AppProviders in index.react.tsx)        │
└────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│               react-app/shell/app-root.tsx                 │  Route root
└────────────────────────────────────────────────────────────┘
                              │
     ┌──────────────┬─────────┼──────────┬──────────────┬──────────────┐
     ▼              ▼         ▼          ▼              ▼              ▼
 domains/session  workspace  settings  messaging   local-agents  task-center
 (surface/sync/   create/    pages/    automation/  management/
  chat/goal)      share/     state/    channels     cards/ACP
                  files                                   Desktop IPC
```

## State ownership

### Decision table (where new state goes)

| Kind of data | Put it in | Do not |
| --- | --- | --- |
| Workspace / session identity | URL params (`workspaceId`, `sessionId`) | App-global “current session” as source of truth |
| Server lists, caches, refetch | TanStack Query (`infra/query-client.ts`) | Duplicating the same list in Zustand |
| Connection / SDK / local runtime | `kernel/*-provider.tsx` | New top-level providers without updating `shell/providers.tsx` |
| Feature UI ephemeral (drawer open, draft text) | Domain store or local `useState` | Kernel store |
| Cross-route user prefs | One named domain store + explicit storage key | Ad-hoc `localStorage` in page JSX |
| App-wide rare flags | `kernel/store.ts` (keep thin) | Growing kernel into a god store |
| Goal runtime (pursue goal) | Session-scoped stores under `session/` keyed by `sessionId` / `draft:<workspaceId>` | Workspace-global goal state |

### Existing homes

- `react-app/kernel/store.ts`: thin Zustand app-wide container; selectors in `kernel/selectors.ts`.
- `react-app/kernel/{server,global-sdk,global-sync,local}-provider.tsx`: server, SDK, sync, local runtime.
- `react-app/kernel/platform.tsx`: `PlatformProvider` + `createDefaultPlatform()` (Electron vs web).
- `react-app/kernel/system-state.ts`: reload + reset modal state.
- `react-app/kernel/model-config.ts`: model parse/serialize + `useDefaultModel()`.
- `react-app/kernel/user-error.ts`: scenario templates (`userErrorCopy` / `presentUserError` /
  `userErrorFromRaw`) for route banners and provider failures — prefer over raw SDK strings.
- `react-app/infra/query-client.ts`: TanStack Query singleton.
- Domain stores: `session/sync/*`, `settings/state/*`, `connections/*`, etc.

## Shell load / boot (cold start)

| Piece | Role |
| --- | --- |
| `shell/boot-state.tsx` | Boot phase + one-way `routeReady` latch; progressive hide once shell can paint |
| `shell/loading-overlay.tsx` | Full-screen overlay; prefers active `route-load-registry` message when busy |
| `shell/route-load-registry.ts` | Nested load scopes (`desktop-boot`, `route-session`, `route-settings`, `session-refresh`, …) |
| `shell/load-surface.tsx` | Shared `LoadSurface` + `useLoadScope` for boot/route/inset chrome |
| `shell/session-memory.ts` | Workspace prefs + **sidebar session title cache** for cold-start paint |
| `shell/session-route/prewarm-hook.ts` | Idle-deferred provider/inventory prewarm (must not race first `listSessions` / snapshot) |
| `shell/settings-route/providers-prewarm-hook.ts` | Settings AI tab inventory prewarm (same idle policy) |

Rules for implementers:

- First route open reports `route-session` / `route-settings`; after the shell is interactive, soft
  refreshes use quieter scopes (e.g. `session-refresh`) and must not re-blank page chrome.
- Mark boot `routeReady` as soon as workspace chrome can paint (desktop workspace list + optional
  cached sidebar titles); do not wait for full engine warm-up to dismiss the overlay.
- Prewarm is **idle / deferred only** (e.g. `requestIdleCallback` + timeout fallback). Do not block
  first paint or re-issue a full `provider.list` that duplicates the cold session path.
- **Cold path must not thrash tab titles / session snapshots** for empty or selected-only chips
  (no tight poll that re-hits OpenCode for title on every enter). Prefer deferred / idle work after
  first paint; see monorepo summary in `docs/Architecture.md` **Session / Expert / cold-path pointers**.
- Numeric budget + counters: `shell/session-route/cold-path-budget.ts`
  (`maxListSessionsOnColdEnter=1`, `maxTitleSnapshotsOnColdEnter=0`, `maxSyncPrewarmOnColdEnter=0`).
  Prewarm only via `scheduleIdleWork` (idle timeouts from the same budget module).
- User-visible load copy keys live under `system.load_*` / `system.boot_*` in i18n — do not reuse
  session message-pulling copy for workspace/route loads.
- Product errors: classify through `kernel/user-error` before showing route banners; wire recovery
  actions (`retry` / `open_ai_settings` / `reload_app`) when the host has a button slot.

## Expert surface (session domain)

**SoT:** [`docs/design/expert-surface-architecture.md`](../../../../docs/design/expert-surface-architecture.md)

Owns Expert **UI lifecycle** under `domains/session/pages/*expert*` + `sidebar/agent-session-tabs.tsx`:

| Piece | Role |
| --- | --- |
| `expert-surface-machine.ts` | Single FSM: `route` ⊥ `draft` ⊥ `pendingTabSessionId` (tab highlight only) |
| `expert-surface-mode.ts` | Pure projection → `idle_draft` / `creating` / `real_session` |
| `order-conversation-groups.ts` + `use-expert-route-lifecycle.ts` | Cold-open; suppress during create/draft |
| `use-expert-conversation-tabs.tsx` + `agent-session-tabs.tsx` | Tab strip; no layout setState title machines; snapshots selected-only |

**Hard bans (have caused white screens):**

- Do not drive tab “总结中” with `useLayoutEffect` + `setState`.
- Do not pass `creatingSessionId` as `pendingSessionId` (cannot clear → max update depth).
- Do not open N title-snapshot queries for every tab chip.
- Do not cold-open / clear-route / create-task while create or draft transaction is active.

Product behavior invariants live in `docs/Architecture.md` Session / Expert (package AGENTS is verify-only). Runtime agent/skills isolation:
`docs/design/expert-runtime-isolation.md`.

## `shared/` contents (current)

`domains/shared/` is **not** a product domain. Physical contents today:

| Path | Role |
| --- | --- |
| `env-context.ts` | OnMyAgent/env system context helpers |
| `extension-state.ts` | Extension enable/hide flags |
| `extension-registry.tsx` | Extension config/runtime registration |
| `desktop-config-context.ts` | Desktop config context |
| `onmyagent-server-store.ts` | Local server connection store |
| `onmyagent-den-help-link.tsx` | Den help link composite |
| `assistant-archived-tasks.ts` | Archived-task helpers used by chrome |
| `session-parent-tree.ts` | Session parent-tree walk helpers |
| `memory/` | Conversation / work-memory file sync |
| `personalization/` | Onboarding vertical rank / automations |
| `index.ts` | Infra exports only (no session-identity re-export) |

Do not add product pages, modals, or registries here.

### Historical migration (done; keep for archaeology)

| Former home under `shared/` | Current owner |
| --- | --- |
| status toasts | `shell-feedback/` |
| MCP / provider auth modals | `connections/` |
| workspace create/share modals | `workspace/` |
| plugins-page / skills-catalog / skill-scope | `plugins/` |
| agent-registry / pending-agent / agent-session-state | `agents/` |

### Former `session/components/shared-pages/` (cleared)

| Former area | Current home |
| --- | --- |
| `agent-management-*` | **`local-agents/agent-management/`** — import from `domains/local-agents` |
| `automation-*`, channel panels | **`messaging/`** — import from `domains/messaging` |
| `workspace-files-page.tsx` | **`workspace/`** — import from `domains/workspace` |
| Rail / conversation lists / panel chrome | **`session/sidebar/`** (+ `session-chrome.ts` barrel) |
| Side panel pages (Store, Billing, …) | **`session/components/side-panel-pages.tsx`** |
| Empty artifacts panel | **`session/surface/chrome/empty-artifacts-panel.tsx`** |

Import product pages from the owning domain barrel; session chrome from `session/sidebar/*`.

## Session goal lifecycle

Behavior lives in code under `session/surface/` and related composer modules.
Temporary design notes / execution plans stay in local `.loop/` only (not under `docs/`).

Summary for implementers:

- Collaboration mode shape stays `{ planning, pursueGoal }`; goal mode is `pursueGoal: true`.
- Goal preview shows before first send; first send creates session-scoped goal runtime.
- Pause / resume / clear affect only the current `sessionId` (draft key migrates on create).
- Goal and planning runtimes are mutually exclusive in the UI.

## File size / route rules (engineering)

- **Routes** (`shell/*-route.tsx`): orchestration only — URL, panel switch, context wiring.
  No plan-text parsing, no large presentational trees.
- **Session hub freeze**: new product features must not land in
  `domains/session/knowledge`, `domains/session/browser`, or `domains/session/usage`.
  Knowledge UI extracts to `domains/knowledge`. Personal usage extracts to
  `domains/settings/usage`. Browser stays frozen until a named later extract.
- **New modules**: prefer ≤400 lines. Stock god files shrink by extraction, not rewrite.
- **UI primitives**: `components/ui/*` atoms + `design-system/*` composites; shell chrome contracts in `DESIGN.md` § 4i.
- Prefer `@/` imports over deep `../../../` chains when adding new files.

## Active workspace and session

Workspace and session identity are route state, not app-global mutable state.

Canonical workspace-scoped routes:

- `/workspace/:workspaceId/session`
- `/workspace/:workspaceId/session/:sessionId`
- `/workspace/:workspaceId/settings/:tab`
- `/workspace/:workspaceId/settings/extensions/:section`

Use `react-app/shell/workspace-routes.ts` to build these paths. Do not hand-build `/session/...`
or `/settings/...` URLs for workspace-scoped flows.

Rules for agents and future code:

- In session or workspace-scoped settings routes, read the active workspace from the URL
  `workspaceId` param first.
- Read the active session from the URL `sessionId` param. A selected session should never imply a
  different workspace than the URL workspace.
- The legacy `onmyagent.react.activeWorkspace` and `onmyagent.react.sessionByWorkspace` values are
  only restore/fallback memory. They are not authoritative while a workspace-scoped URL is active.
- `/session`, `/session/:sessionId`, and `/settings/*` are compatibility entry points. They should
  redirect to workspace-scoped URLs when the workspace can be resolved.
- Missing URL resources should not silently fall back to the first workspace. Show a not-found state
  and let the user pick a workspace/session from the sidebar.
- Workspace-scoped actions (rename workspace, create session, open MCP/settings tabs, quick actions,
  commands, delete session) should use the URL-derived workspace/session context or receive explicit
  workspace/session ids from the caller.

Practical examples:

- From session B in workspace B, opening settings should navigate to
  `/workspace/B/settings/general`.
- Opening a session from the command palette should navigate to
  `/workspace/<owner-workspace-id>/session/<session-id>`, where the owner is found from the session
  list.
- Creating a new task in a workspace should navigate to
  `/workspace/<workspace-id>/session/<new-session-id>`.

## Framework-agnostic boundary

Code that is runtime-agnostic lives under `src/app/` and is imported by the React
tree when a domain-scoped import path is clearer:

- `app/lib/*` (opencode, desktop, onmyagent-server, ...) — consumed directly by React.
- `app/types.ts`, `app/constants.ts`, `app/theme.ts`, `app/utils/*` — shared utilities.
- `app/session/composer-tools.ts` — shared session helpers.

## Route entry rule (enforced)

- **Session host:** `shell/session-route/` is a **folder facade**. Public entry is
  `session-route/index.ts` (re-exports `SessionRoute` from `render.tsx` plus intent /
  chrome / composer modules). Keep `index.ts` thin (≤80 lines). Heavy composition
  stays in `render.tsx` / `page-view.tsx` / sibling modules — do not reintroduce a
  root-level `session-route.tsx` god file.
- **Settings host:** `shell/settings-route/` folder facade (`index.ts` + `render.tsx` + modules);
  `settings-route-render.tsx` is a compat re-export. AI providers tab UX is driven by
  `domains/settings/state/ai-providers-controller.ts` (merge via
  `connections/mergeConnectedProviders`).
- Guard: `node scripts/checks/architecture-paths.mjs` (expects `session-route/index.ts`
  + `session-route/render.tsx` + thin settings entry).

## Domain README template

When adding `domains/<name>/README.md`, use:

```markdown
# domains/<name>

One-line purpose.

## Ownership
- Owns …
- Does not own …

## Public surface
- Prefer `./index.ts` barrel. Note if no barrel yet.

## Lateral dependencies
- Allowed: …
- Forbidden: …

## Do not
- Product features in `domains/shared`
- Import `shell/*` from a domain
```
