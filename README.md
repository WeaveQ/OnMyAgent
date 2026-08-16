# OnMyAgent

[中文](./README-zh.md) | [English](./README.md)

## Documentation

| Need | Doc |
| --- | --- |
| Quick start (this page) | continue below |
| Contribute / PR | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |
| AI agent rules | [`AGENTS.md`](./AGENTS.md) |
| Architecture | [`docs/Architecture.md`](./docs/Architecture.md) |
| UI / visual contract | [`DESIGN.md`](./DESIGN.md) |
| Full doc map | [`docs/README.md`](./docs/README.md) |
| Phase 2 / enterprise prep | [`docs/design/2026-08-02-phase-2-enterprise-prep.md`](./docs/design/2026-08-02-phase-2-enterprise-prep.md) |

**Local office workspace. Work stays on your machine; pick any model.**

OnMyAgent is an open-source **desktop office agent workspace** — drafts, sheets, automations, and approvals on your computer, not another cloud chat window.

**Product phase:** **Phase 2** — ship a durable local config foundation and prepare for optional **intranet B-side control** (OnMyCompany: identity, isolation, policy, audit, gateway). **Logged-out local use remains the default**; company connect is opt-in, not a login wall. Details: [phase-2 roadmap](./docs/design/2026-08-02-phase-2-enterprise-prep.md).

- **Office-first**: home chat, files, automations, and channels for everyday work deliverables.
- **Local-first**: workspace and outputs default to this machine; sensitive actions can require approval.
- **Any model (BYOK)**: hosted providers, compatible APIs, local Ollama, and more — not locked to one vendor.
- **Experts & verticals later**: marketplace and industry experts keep improving; the current promise is a solid office path, not unfinished verticals.
- **Org control (roadmap)**: prepare isomorphic config + dual-mode for internal OnMyCompany pilots — not a public multi-tenant SaaS claim.

Advanced access (local coding CLIs, MCP, multi-agent) remains available under settings / advanced entry points, not as the default home story.

## Why OnMyAgent?

Models are strong enough for office work. What’s missing is finishing work **locally**, keeping it, and running it again on a schedule:

- Chat apps are great at talk, but files, schedules, approvals, and channels are often scattered.
- Many office agents lock you to one model or cloud with opaque data paths.
- Developer CLIs are powerful, but they are not a default office entry.
- You need a local workspace: read/write files, resumable sessions, reviewable artifacts.

OnMyAgent is **local office + bring-your-own-model** — not a chat clone and not a cloud workflow canvas.

## What It Is

OnMyAgent is:

- A **local office desktop workspace** for knowledge workers and AI users.
- One place for sessions, files, automations, skills/experts, messaging channels, and approvals.
- A **local-first, BYOK, provider-neutral** open-source project.

OnMyAgent is not:

- A generic chat clone.
- A cloud workflow platform like n8n, Dify, or Zapier.
- A public multi-tenant hosted enterprise SaaS (Phase 2 prepares **intranet** OnMyCompany-style control for pilots; local-first remains the default).
- A replacement for Cursor / Claude Code as a coding IDE (local coding agents are advanced attach points).

## How It Relates to Other Tools

| Tool | What it does | How OnMyAgent relates |
|------|--------------|----------------------|
| Hosted models / compatible APIs / Ollama | Inference | **Bring your own**; keys and default model live in Settings |
| ChatGPT / consumer chat apps | Conversation UI | Different category: we emphasize **local workspace + files/automations/approvals** |
| WorkBuddy-class office agents | Ecosystem office assistants | Similar job-to-be-done; we stress **local + model choice** |
| OpenCode | Local agent runtime | **Main session / server stack** (implementation detail under the local workspace) |
| Codex / Claude Code CLIs | Coding agents | **Advanced attach** (Personal auxiliary path), not the office home default |
| MCP / Skills | Tools and reusable capabilities | Configured and invoked in the workspace |
| n8n / Dify / Zapier | Cloud workflows | Different category: we focus on **local office tasks**, not canvas orchestration |

## Core Concepts

- **Workspace**: A local folder where tasks and outputs land by default.
- **Session**: A resumable office collaboration.
- **Provider / model**: Any inference service you connect; the default model powers new chats and automations.
- **Automation**: Scheduled or triggered office work (digests, summaries, reminders).
- **Artifact**: Deliverables such as docs, sheets, reports, screenshots — open or edit externally from Files.
- **Experts / skills (extensions)**: Installable capability packs; vertical experts ship as they become ready.

## Features

- **Home sessions**: Dispatch office work and follow progress.
- **Experts & store**: Capability extensions (verticals ship by readiness; not the primary promise pre-launch).
- **Automations**: Schedule recurring office runs and review history.
- **Files**: Workspace files, task outputs, preview / open-in-app.
- **Channels**: Feishu / Weixin-style reach (platform-dependent).
- **Models & settings**: Any provider, default model, env vars, system permissions, preferences.
- **Skills / MCP / Memory**: Reusable capabilities, external tools, long-lived preferences.
- **Permission & approval**: Explicit confirmation for risky local actions.
- **Local-first / BYOK**: Work stays local; you own the keys.
- **Desktop packaging**: macOS primary; Windows NSIS developer preview.
- **Internationalization**: English, Simplified Chinese, Traditional Chinese.

## Platform Support

- **macOS** is the primary release and dogfood target (Apple Silicon + Intel).
- **Windows** runs the Electron shell, sidecars, and most product UI; see
  [`docs/windows-compat.md`](./docs/windows-compat.md) for preflight, NSIS packaging,
  Computer Use (bundled Cua Driver), Appshot, and remaining macOS-only gaps
  (`sandbox-exec`, HandsFree AX/Skysight, code signing).
- **Linux** packages (including Arch AUR) are not supported for now.
- **Computer Use**: macOS uses the HandsFree helper (MCP on by default when staged);
  Windows stages a **Cua Driver** helper (MCP registered, **off by default** —
  set `ONMYAGENT_COMPUTER_USE_ENABLED=1` to enable). Not full HandsFree parity.
- **Appshot** (composer “capture desktop”): Electron `desktopCapturer` on
  **macOS / Windows / Linux** (Linux desktop packages are not a product target); customizable
  global shortcut in Settings → Shortcuts.

## Workflow

```text
Pick a local workspace folder
        ↓
Connect any model (hosted / compatible API / local)
        ↓
Dispatch office work (chat / automation)
        ↓
Approve sensitive actions when needed
        ↓
Open or edit outputs in Files
        ↓
Deliver or continue
```

## Requirements

- Node.js matching `.nvmrc` and `package.json#engines`.
- `pnpm@10.27.0`.
- Bun `1.3.9+` for runtime scripts that use Bun.
- Git.
- OpenCode CLI available on `PATH` when using the OpenCode runtime.
- Xcode Command Line Tools on macOS for desktop development.

## Quick Start

Install dependencies:

```bash
pnpm install
```

Run the desktop app:

```bash
pnpm dev
```

`pnpm dev` starts the Electron shell, UI, and local runtime. It defaults to `desktop` and uses isolated OpenCode state in development mode.

Use the unified dev selector for a specific app:

```bash
pnpm dev -- app
pnpm dev -- server
pnpm dev -- orchestrator
pnpm dev -- headless
```

## Useful Commands

```bash
pnpm check
pnpm check:i18n
pnpm check:security
pnpm check:boundaries
pnpm check:forbidden-types
pnpm task check app
pnpm task check server
pnpm task build app
pnpm test:unit
pnpm test:api
pnpm test:runtime
pnpm test:ui
pnpm task test server:automation
```

| Group | Scripts | Notes |
|------|---------|-------|
| Daily dev | `dev -- <target>` | `dev` defaults to desktop; targets are `app`, `server`, `orchestrator`, and `headless`. |
| Build | `build`, `task build app`, `task build desktop` | Use `task build app` for UI-only builds. |
| Checks | `check`, `check:type`, `check:types:all`, `task check <target>` | Run before handoff. `check:type` runs the full workspace type gate. |
| Test gates | `test:unit`, `test:api`, `test:runtime`, `test:ui` | Layered server/orchestrator, API, Electron/runtime, and app UI smoke coverage. |
| Targeted tests | `task test <target>` | Session, permission, event, automation, server, orchestrator, and module-specific tests. |
| Versioning | `task bump <target>` | App version updates. |
| Website | `task website <target>` | Website dev, build, check, and preview commands. |
| Release | `release:*` | Release review, prepare, and ship flows. |

For local Electron packaging, see `BUILD.md`.

For the full documentation map, see `docs/README.md`.

## Architecture

```text
apps/desktop        Electron shell, IPC, sidecar/runtime management
apps/app            React UI, session workspace, settings, artifacts, i18n
apps/server         Local HTTP API for workspace/session/skill/MCP operations
apps/orchestrator   Host process that starts OpenCode, server, sandbox
packages/types      Shared Zod schemas and type boundaries
packages/ui         Shared React visual components (`@onmyagent/ui/react`)
packages/handsfree  macOS Computer Use (HandsFree); Win CU is desktop Cua Driver
packages/onmyagent-ui-mcp MCP server that lets agents inspect/control the UI
```

The desktop app can start a local host stack, connect to an existing OpenCode server, or attach to a remote worker. The UI talks to the agent backend through the OpenCode SDK and OnMyAgent local APIs.

**Dual-runtime boundary:** OpenCode is the primary session and server source of truth; Personal Local Agent is the desktop harness for local CLI agents (auxiliary path). UI may share a conversation timeline shape; storage and hot-write paths must not cross. See **Dual Runtime Boundary** and **Server Archive Runtime** in `docs/Architecture.md`.

For deeper architecture details, see `docs/Architecture.md`.

## MCP UI Control

`packages/onmyagent-ui-mcp` exposes the desktop UI as MCP tools so agents can inspect and operate published UI actions:

- `ui_status` checks whether the desktop bridge is reachable.
- `ui_snapshot` reads the current route, narration, status, and visible actions.
- `ui_list_actions` lists actions available in the current UI state.
- `ui_execute_action` executes a published UI action by ID.

Use this only against trusted local development sessions.

## Security Model

OnMyAgent is local-first, but it can still touch sensitive surfaces: provider keys, local files, MCP tools, shell commands, and external URLs.

Before submitting changes, run:

```bash
pnpm check:security
```

For vulnerability reporting and project security boundaries, see `SECURITY.md`.

## Current Capabilities And Roadmap

### Main path (office)

- Local workspace sessions, file artifacts, office automations, permissions and approvals.
- **Any model**: hosted providers, compatible APIs, local models; default model and empty-state guidance in Settings.
- Skills / MCP / Memory, software environment, and system permissions (platform-dependent).
- Messaging channels (Feishu / Weixin and similar) on desktop integration paths.
- Experts / store: extension surface; vertical experts ship by readiness — **not a full pre-launch promise**.

### Advanced / engineering (not the default home)

- OpenCode as the local main session stack (server + archive); Personal auxiliary path can attach Codex / Claude Code CLIs.
- UI control bridge and headless / orchestrator developer paths.

### Next milestones

- Keep shrinking **folder → connect model → first successful office task**.
- Productize empty states, default-model status, and failure copy (less engine jargon).
- Grade the expert shelf by readiness; ship verticals in waves.
- Channel E2E, Windows office main path, approval and audit polish.
- Optional team collaboration layer — without blocking the personal office line.

## Contributing

For the full contribution guide, see `CONTRIBUTING.md`.

Before opening a PR:

1. Read `AGENTS.md`, `docs/Architecture.md`, and — for any UI change — `DESIGN.md` (the visual contract at the repo root).
2. Keep changes small and focused.
3. Add or update tests when behavior changes.
4. For cross-module or architecture changes, use Graphify to inspect impact:

```bash
graphify query "what area does this change touch" --budget 1200
graphify affected "path/or/symbol"
```

5. Run the most relevant checks:

```bash
pnpm check:security
pnpm check:i18n
pnpm check:type
pnpm task build app
```

If desktop or runtime behavior changes, also run the relevant Electron or headless smoke test and mention the command in the PR description.

After larger code changes, run `pnpm task graphify build` to refresh `graphify-out/graph.json` (wraps `graphify update . --force --no-cluster`).

Community participation is governed by `CODE_OF_CONDUCT.md`.

## Internationalization

The app currently maintains English, Simplified Chinese, and Traditional Chinese locale files. User-visible product copy should go through the existing i18n system instead of hardcoded single-language strings.

## License

OnMyAgent is licensed under the Apache License 2.0. See `LICENSE` for details.
