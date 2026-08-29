---
name: dual-runtime
description: >
  Apply the OpenCode-primary / Personal-secondary boundary. Use when changing
  sessions, session-archive, SSE, Personal Local Agent, local-agents UI,
  IM assistant, Task Center, or any code that might write both stores.
display_name_zh: "双运行时边界"
display_name_en: "Dual Runtime Boundary"
---

# Dual runtime

SoT: [`docs/Architecture.md`](../../../docs/Architecture.md) **Dual Runtime Boundary** and **Server Archive Runtime**. Gate: `pnpm check:boundaries` (`check-dual-runtime-boundary.mjs`).

## Trigger

Session, archive, Personal runtime, `domains/local-agents`, IM `#task` / 本地助理, Task Supervisor, or a file that imports both an OpenCode/archive module and a Personal store.

## Checklist

1. Name the owner before editing: **OpenCode / server** (main chat, archive, SSE, workspace sessions) or **Personal** (local CLI/ACP harness, personal conversation store). Default to OpenCode if unsure.
2. Do not add a second hot write to the same logical session. IM 本地助理 is the documented OpenCode exception — do not also hang a Personal run on that session.
3. Personal must not open, write, or dispose session-archive / main session SQLite. OpenCode must not treat the Personal store as the main session SoT.
4. Archive → Personal resume is a **one-way copy** (`session-archive-resume`). Never write back to the main archive from that path.
5. Renderer must not import `personal-agent-runtime/**`. Use `desktop.ts` IPC and `onmyagent-server` HTTP only.
6. Same file must not mix the two store import families (the dual-runtime check fails this).

## Verify

```bash
pnpm check:boundaries
```

If the change is a session PR, also load `session-write-path`.
