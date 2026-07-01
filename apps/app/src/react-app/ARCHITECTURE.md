# React App Architecture (`src/react-app/`)

This document captures the domain-based layout for the React runtime in
`apps/app`. React is the sole UI runtime; the previous Solid runtime and its
migration shims have been removed.

## Top-level layout

```text
src/react-app/
├── shell/                     App bootstrap, providers composition, startup effects
├── kernel/                    App-wide state + provider contracts
├── infra/                     React-only runtime infra
├── design-system/             Reusable presentational primitives + small modal primitives
└── domains/                   Feature-scoped code, one folder per product domain
    ├── session/               Route frame + surface + sync + sidebar + voice
    │   ├── chat/              Composer, question/permission surfaces
    │   ├── surface/           Transcript, markdown, tool-call, debug panel
    │   ├── sync/              Session state plumbing (store, runtime, chat adapter)
    │   └── modals/            Model picker, question, rename-session
    ├── workspace/             Create + share + rename workspace flows
    ├── settings/
    │   ├── state/             Settings-scoped hooks/providers
    │   ├── pages/             Plugins, extensions, config, agents, ... (tab bodies)
    │   └── modals/            Reset modal, ...
    ├── connections/
    │   └── modals/            Add-MCP, provider auth, ...
    ├── agents/                Agent registry + personal local agent pages
    ├── cloud/                 Den auth + restrictions + org onboarding
    ├── plugins/               Skills catalog
    ├── shared/                Cross-domain utilities and shared state
    └── shell-feedback/        Status toasts, reload banner, top-right notifications
```

## Why domains

Domain ownership gives every feature one obvious home.

- `session/` owns everything the session route renders, including the state layer under `sync/`.
- `workspace/` owns every workspace-modal flow, so create/share/rename live together.
- `settings/` owns settings state, the full settings shell, and each tab body as a stateless page under `pages/`.
- `connections/` owns MCP and provider auth UI.
- `agents/` owns the local-agent registry, agent management, and provider adapters.
- `cloud/` owns organization and authentication flows.
- `plugins/` owns skill discovery, installation, and management.
- `shell-feedback/` owns toasts and notifications that the shell shows on top of everything.

Cross-domain imports go through module boundaries, not a shared blob.

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

- `react-app/kernel/store.ts`: Zustand store, the single app-wide state container.
  Domain selectors in `kernel/selectors.ts`.
- `react-app/kernel/{server,global-sdk,global-sync,local}-provider.tsx`: React context
  providers for server connection, SDK, sync, and local runtime.
- `react-app/kernel/platform.tsx`: `PlatformProvider` + `createDefaultPlatform()` helper
  (Electron-vs-web).
- `react-app/kernel/system-state.ts`: `useSystemState()` for reload + reset modal state.
- `react-app/kernel/model-config.ts`: framework-agnostic model parse/serialize helpers plus
  `useDefaultModel()`.
- `react-app/infra/query-client.ts`: TanStack Query singleton.
- Feature-specific state that is tightly coupled to one domain lives inside that domain
  (`domains/session/sync/`, `domains/settings/state/`).

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
