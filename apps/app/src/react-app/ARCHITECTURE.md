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
│   └── app-root / providers   Route tree composition
├── kernel/                    App-wide state + provider contracts
├── infra/                     React-only runtime infra (e.g. QueryClient)
├── capabilities/              Cross-domain application capabilities with neutral ownership
│   ├── artifacts/             Markdown, Office preview, open-target and artifact contracts
│   ├── conversation/          Dual-runtime timeline / item VM (OpenCode + Personal → one UI shape)
│   ├── model-selection/       Shared model selection container + hidden-model state
│   └── session-identity/      Session/workspace identity persistence shared by domains
├── design-system/             Product composites (ConfirmModal, SelectMenu, LabeledInput, …)
└── domains/                   Feature-scoped code, one folder per product domain
    ├── session/               Live conversation runtime (transcript, composer, sync, goal)
    │   ├── chat/              Session host pages + light panels (personal host re-exports)
    │   ├── surface/           Transcript, composer, plan-goal helpers, markdown
    │   ├── sync/              Session state plumbing
    │   ├── components/        Session-local UI (permission modal, status bar, side-panel pages, …)
    │   ├── sidebar/           Rail, conversation lists, chrome barrel (session-chrome.ts)
    │   │                        main rail bottom: channels + devices icons
    │   ├── voice/ browser/ infinite-canvas/ skills-marketplace/ expert-marketplace/
    │   └── modals/
    ├── local-agents/          ACP / local agent editors, cards, agent-management, personal host
    ├── messaging/             Automations + Feishu/Weixin channel panels
    ├── agents/                Agent registry UI + personal agent pages
    ├── plugins/               Skills catalog / plugins / connectors pages
    ├── workspace/             Create + share + rename + workspace files
    ├── settings/              Settings shell + tab bodies under pages/ (incl. global Updates)
    ├── connections/           MCP + provider auth (canonical owner)
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

- `session/` owns the **live conversation runtime** (surface, sync, composer, voice, goal
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
- `messaging/` owns automation pages and messaging channel panels (Feishu, Weixin, pairing).
  Automation session records are exported from `domains/messaging/index.ts`.
- `agents/` owns registry-facing agent pages and selection UX.
- `plugins/` owns skills catalog and plugins/connectors pages.
- `workspace/` owns every workspace-modal flow and workspace files page.
- `settings/` owns settings state, shell, and tab bodies under `pages/`.
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
     ┌──────────────┬─────────┼──────────┬──────────────┐
     ▼              ▼         ▼          ▼              ▼
 domains/session  workspace  settings  messaging   local-agents
 (surface/sync/   create/    pages/    automation/  management/
  chat/goal)      share/     state/    channels     cards/ACP
                  files
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
- `react-app/infra/query-client.ts`: TanStack Query singleton.
- Domain stores: `session/sync/*`, `settings/state/*`, `connections/*`, etc.

## `shared/` contents (current)

`domains/shared/` is **not** a product domain. Physical contents today:

| Path | Role |
| --- | --- |
| `env-context.ts` | OnMyAgent/env system context helpers |
| `extension-state.ts` | Extension enable/hide flags |
| `desktop-config-context.ts` | Desktop config context |
| `onmyagent-server-store.ts` | Local server connection store |
| `onmyagent-den-help-link.tsx` | Den help link composite |
| `index.ts` | Infra exports + thin re-exports of session-identity helpers from `agents/` |

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
  `settings-route-render.tsx` is a compat re-export.
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
