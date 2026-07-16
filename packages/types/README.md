# @onmyagent/types

Shared Zod (v4) schemas and TypeScript types that form the wire-level
contract between OnMyAgent packages. No runtime business logic lives here.

## Why This Package Exists

Every cross-boundary interface (renderer ↔ Electron main, server ↔ orchestrator,
desktop ↔ MCP clients, session archive files on disk) needs one authoritative
schema so drift can't hide behind ad-hoc types.

## Public Entrypoints

Each subpath is a stable Zod / type export. Import via the barrel unless you
need one narrow slice.

| Import | Purpose |
| --- | --- |
| `@onmyagent/types` | Aggregated barrel: channels, session archive, code workspace types, Den policies / inference. |
| `@onmyagent/types/desktop-ipc` | Electron IPC payload and response schemas. |
| `@onmyagent/types/desktop-ipc-commands` | **Runtime SoT** for IPC command names, grouped by domain. Used by dispatcher + parity tests. |
| `@onmyagent/types/session-archive` | Session archive persistence + parser types. |
| `@onmyagent/types/server` | Local HTTP API types (types-only export). |
| `@onmyagent/types/server-client-methods` | Runtime method table for typed HTTP client wiring. |
| `@onmyagent/types/channel` | Messaging channel (Feishu / Weixin) contract shared across desktop, server, and renderer. |
| `@onmyagent/types/den/*` | Den (cloud) restrictions, policies, and inference schemas. |

## Boundary Rules

- **Zod v4 only.** Do not import earlier Zod versions here or elsewhere.
- **No dependency on `apps/*` or other `packages/*`.** Enforced by
  `pnpm check:boundaries`.
- **No business logic**, only schema + inferred types.
- Adding a new IPC command means editing `src/desktop-ipc-commands.mjs`
  (grouped array) — that file is the runtime source of truth; renderer typing
  and Electron dispatch both consume it.

## Related Docs

- `AGENTS.md` § 项目骨架 — package-level index.
- `docs/Architecture.md` § Package Boundaries — dependency contract.
- `docs/Architecture.md` § Runtime Adapter — how these types back the
  adapter protocol.
