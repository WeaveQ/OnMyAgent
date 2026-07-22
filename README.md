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

**One workspace to manage all your local agents.**

OnMyAgent is an open-source desktop workspace and local control plane for agentic work.

It does not replace Codex, Claude Code, OpenCode, or other coding agents.
It manages them.

OnMyAgent brings local agents, MCP tools, skills, memory, automations, sessions, logs, diffs, and artifacts into one desktop workspace — turning scattered agent tools into trackable, reviewable, and deliverable AI Worker flows.

## Why OnMyAgent?

AI agents are getting powerful. The problem is no longer the lack of agents.
The problem is that agent work is scattered:

- Codex, Claude Code, OpenCode, and other agent CLIs live in separate terminals.
- MCP tools, model keys, project context, and permissions live in different config files.
- Sessions, tasks, logs, diffs, and artifacts are hard to review together.
- Agents can execute, but you still need a control plane to queue, monitor, approve, resume, and deliver work.
- Local-first workflows need clear security and approval boundaries.

OnMyAgent is not another agent.

It is the local control plane that turns scattered agent runs into manageable Worker workflows.

## What It Is

OnMyAgent is:

- An open-source Worker workspace for developers and AI power users.
- A local agent control plane for Codex, Claude Code, OpenCode, and OpenCode-compatible runtimes.
- A desktop workspace for work queues, sessions, logs, diffs, artifacts, MCP tools, skills, memory, and approvals.
- A local-first, BYOK, auditable project that aims to stay extensible and provider-neutral.

OnMyAgent is not:

- A replacement for Codex, Claude Code, OpenCode, or every coding agent CLI.
- A cloud workflow automation platform like n8n, Dify, or Zapier.
- A hosted enterprise governance product.
- A generic chat clone.

## How It Relates to Other Agent Tools

| Tool | What it does | How OnMyAgent relates |
|------|--------------|----------------------|
| Codex | Coding agent runtime | Managed as a local Worker |
| Claude Code | Coding agent CLI | Managed as a local Worker |
| OpenCode | Open-source coding agent runtime | **Primary runtime / main session stack** (server, archive, SSE) |
| Personal Local Agent | Local CLI/ACP harness (Claude Code, Codex, …) | **Auxiliary path**: unified desktop access; does not replace OpenCode |
| MCP servers | External tool connectors | Configured, inspected, and controlled from OnMyAgent |
| Skills | Reusable agent capabilities | Installed, organized, and invoked through the workspace |
| ChatGPT / LibreChat | Chat interface | Different category: OnMyAgent is a local control plane, not a chat clone |
| n8n / Dify / Zapier | Cloud workflow automation | Different category: OnMyAgent focuses on local-first agent work |

## Core Concepts

- **Agent**: A tool that can reason and act, such as Codex, Claude Code, or OpenCode.
- **Worker**: An agent with task context, permissions, execution state, logs, and deliverables.
- **Control Plane**: The desktop layer that connects, monitors, approves, and reviews local Workers.
- **Session**: A resumable unit of agent work.
- **Artifact**: The output of work: files, diffs, reports, screenshots, documents, or other deliverables.

## Features

- **Agent Registry**: Register and manage local agents such as Codex, Claude Code, and OpenCode.
- **Worker Workspace**: Queue, run, pause, resume, and review agent tasks.
- **Session Manager**: Track and restore local agent sessions across projects.
- **Automations**: Schedule recurring local agent runs and review their history.
- **MCP Control**: Configure MCP servers and expose UI actions through MCP.
- **Skills & Memory**: Organize reusable capabilities and project context.
- **Software & Environment Settings**: Manage bundled runtimes, API keys, local environment variables, and platform permissions (macOS Accessibility / Screen Recording where required).
- **Artifact Review**: Review logs, diffs, files, screenshots, and deliverables in one place.
- **Permission & Approval**: Add explicit approval surfaces for risky local actions.
- **Local-first / BYOK**: Keep work on your machine and use your own model/provider keys.
- **Desktop Packaging**: Electron packaging for macOS (primary) and Windows NSIS (developer preview).
- **Internationalization**: English, Simplified Chinese, and Traditional Chinese locale files.

## Platform Support

- **macOS** is the primary release and dogfood target (Apple Silicon + Intel).
- **Windows** runs the Electron shell, sidecars, and most product UI; see
  [`docs/windows-compat.md`](./docs/windows-compat.md) for preflight, NSIS packaging,
  and macOS-only gaps (Computer Use / Appshot desktop capture, `sandbox-exec`).
- **Linux** packages (including Arch AUR) are not supported for now.
- **Computer Use + Appshot** require the native HandsFree helper and are **macOS only**.

## Workflow

```text
Connect local agents
        ↓
Create or import a task
        ↓
Run it as a Worker
        ↓
Track sessions, logs, diffs, and approvals
        ↓
Review artifacts
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
packages/handsfree  Local Computer Use runner
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

### Available Today

- OpenCode primary-path sessions, tasks, automations, artifacts, logs, permissions, and approvals (server + archive).
- Local agent registry and provider switching (Personal auxiliary path: Codex, Claude Code, and other CLI/ACP agents).
- Skill, MCP, provider, model, memory, software environment, and workspace management in the desktop UI.
- Local messaging channels for personal-agent workflows, including Weixin and Feishu desktop integration paths.
- UI control bridge and local-first server/orchestrator runtime for desktop and headless development.

### Next Milestones

- Keep reducing cold-start cost by splitting low-frequency settings, Skill, and syntax-highlighting surfaces.
- Harden real external-channel E2E coverage for Feishu and Weixin when credentials and callback access are available.
- Continue modularizing desktop main-process and session/settings composition roots.
- Expand work detail views, audit trails, and safer approval policy presets.
- Prepare the team worker layer: shared workspaces, team permissions, organization audit, Skill Packs, and enterprise deployment options.

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

After larger code changes, run `graphify update .` to refresh `graphify-out/graph.json`.

Community participation is governed by `CODE_OF_CONDUCT.md`.

## Internationalization

The app currently maintains English, Simplified Chinese, and Traditional Chinese locale files. User-visible product copy should go through the existing i18n system instead of hardcoded single-language strings.

## License

OnMyAgent is licensed under the Apache License 2.0. See `LICENSE` for details.
