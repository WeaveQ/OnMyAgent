# React App Architecture (`src/react-app/`)

This document captures the domain-based layout for the React runtime in
`apps/app`. React is the sole UI runtime; the previous Solid runtime and its
migration shims have been removed.

## Top-level layout

```text
src/react-app/
├── shell/                     App bootstrap, providers, route frames (orchestration only)
├── kernel/                    App-wide state + provider contracts
├── infra/                     React-only runtime infra (e.g. QueryClient)
├── design-system/             Product composites (ConfirmModal, SelectMenu, …)
└── domains/                   Feature-scoped code, one folder per product domain
    ├── session/               Live conversation runtime (transcript, composer, sync)
    │   ├── chat/              Host pages + light panels
    │   ├── surface/           Transcript, composer, plan-goal helpers, markdown
    │   ├── sync/              Session state plumbing
    │   ├── components/        Session-local UI (permission modal, status bar, …)
    │   │   └── shared-pages/  TRANSITIONAL workbench panels (see migration map)
    │   ├── voice/ browser/ infinite-canvas/ skills-marketplace/ expert-marketplace/
    │   └── modals/
    ├── local-agents/          ACP / local agent editors, cards, management UI target
    ├── agents/                Agent registry UI + personal agent pages
    ├── workspace/             Create + share + rename workspace flows
    ├── settings/              Settings shell + tab bodies under pages/
    ├── connections/           MCP + provider auth (canonical owner)
    ├── cloud/                 Den auth + restrictions + org onboarding
    ├── shell-feedback/        Reload banner, top-right notifications
    └── shared/                TRANSITIONAL cross-domain bag (see migration map)
```

**`domains/plugins/`** exists as a **public entry** (`plugins/index.ts`) that re-exports
the transitional implementations still under `shared/` (plugins-page, skills-catalog,
skill-scope). New imports should use `domains/plugins`; physical move of files is
follow-up.

Atoms live outside this tree: `apps/app/src/components/ui/*` (see `DESIGN.md` § 4 / § 4i).

## Why domains

Domain ownership gives every feature one obvious home.

- `session/` owns the **live conversation runtime** (surface, sync, composer, voice).
  It must not become the permanent home for agent management / messaging channels
  (those are migrating out of `session/components/shared-pages/`).
- `local-agents/` owns local/ACP agent edit, cards, and (target) management pages.
- `agents/` owns registry-facing agent pages and selection UX.
- `workspace/` owns every workspace-modal flow (create/share/rename).
- `settings/` owns settings state, shell, and tab bodies under `pages/`.
- `connections/` owns MCP and provider auth UI (**canonical**; do not add new auth modals under `shared/`).
- `cloud/` owns organization and Den authentication flows.
- `shell-feedback/` owns reload banners and top-right notification chrome.
- `shared/` is **transitional** — re-exports and leftovers only; no new product features.

Cross-domain imports go through domain public entrypoints (`domains/<name>/index.ts`
where present) or explicit paths — not a growing shared blob.

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
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
   domains/session     domains/workspace   domains/settings
           │                  │                  │
           ▼                  ▼                  ▼
  surface/, sync/,    create-/share-/     pages/ (plugins,
   chat/, modals/     rename-*.tsx        config, agents, ...),
                                           modals/, state/
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

### Existing homes

- `react-app/kernel/store.ts`: thin Zustand app-wide container; selectors in `kernel/selectors.ts`.
- `react-app/kernel/{server,global-sdk,global-sync,local}-provider.tsx`: server, SDK, sync, local runtime.
- `react-app/kernel/platform.tsx`: `PlatformProvider` + `createDefaultPlatform()` (Electron vs web).
- `react-app/kernel/system-state.ts`: reload + reset modal state.
- `react-app/kernel/model-config.ts`: model parse/serialize + `useDefaultModel()`.
- `react-app/infra/query-client.ts`: TanStack Query singleton.
- Domain stores: `session/sync/*`, `settings/state/*`, `connections/*`, etc.

## `shared/` migration map (transitional)

`domains/shared/` is not a product domain. Prefer the target below for **new** code;
migrate when touching a file.

| Current (`shared/`) | Target domain | Notes |
| --- | --- | --- |
| `status-toast(s).tsx` | `shell-feedback/` | Toasts already partially live there |
| `add-mcp-modal.tsx` | `connections/` | Canonical MCP owner |
| `provider-auth-modal.tsx`, `provider-auth-types.ts`, `provider-list-query.ts` | `connections/` | Collapse with `connections/provider-auth/*` |
| `share-workspace-*.tsx`, `workspace-modal-types.ts`, `workspace-option-card.tsx` | `workspace/` | Keep workspace flows together |
| `plugins-page.tsx`, `skills-catalog.ts`, `skill-scope.ts`, `bundled-skill-locale.ts` | **`plugins/` entry** (re-exports live; move files later) | Import via `domains/plugins` |
| `agent-registry-*.ts(x)`, `pending-agent-store.ts`, `agent-session-state.ts`, `agent-default-registry.ts`, `agent-prompt-suggestions.tsx` | `agents/` (or `local-agents/` for pending draft) | **Eliminate dual stores** with `agents/*-store` |
| `onmyagent-server-store.ts`, `extension-state.ts`, `env-context.ts`, `desktop-config-context.ts` | keep in `shared/` until a kernel/infra home is clearer | Low priority |
| `modal-styles.ts`, `onmyagent-den-help-link.tsx` | design-system / cloud as appropriate | Cosmetic |

### `session/components/shared-pages/` migration map

| Current area | Target | Phase |
| --- | --- | --- |
| `agent-management-*` | **`local-agents/agent-management/`** (moved) | P4 done; session re-exports for compat |
| `automation-*`, channel panels (`weixin`, `feishu`, …) | `settings/` or future `messaging/` | After P4 |
| `workspace-files-page.tsx` | `workspace/` | After P4 |
| Conversation lists / true session chrome | stay in `session/` | — |

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
