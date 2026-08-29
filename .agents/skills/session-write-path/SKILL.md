---
name: session-write-path
description: >
  Require a named session write-path owner on session, expert, Task, IM, and
  archive work. Use when creating or reviewing a session PR, touching
  domains/session, expert surface, Task Center, or IM-assistant chat.
display_name_zh: "会话写路径 owner"
display_name_en: "Session Write-Path Owner"
---

# Session write-path owner

SoT: root [`AGENTS.md`](../../../AGENTS.md) (Session 写路径) and [`docs/Architecture.md`](../../../docs/Architecture.md) Dual Runtime + Session / Expert. Hub budget: `check-session-hub-budget.mjs`.

## Trigger

Any PR or task that changes how a session is created, prompted, archived, resumed, or shown — including Expert surface, Task Center, and IM chat.

## Checklist

1. State the write-path owner in the PR Plan section: **OpenCode**, **Personal**, or **Task**.
2. IM-assistant (本地助理) is the only documented exception: it hot-writes OpenCode `session.create` / `promptAsync` on purpose. Say so explicitly; do not add a Personal write beside it.
3. Do not grow `domains/session` frozen extract pockets. New product work lands outside the hub.
4. Name the proof command that shows the owner (`pnpm test:ui` invariants, desktop channel tests, or the package `AGENTS.md` verify entry).
5. If you cannot name an owner, stop and ask — do not invent a dual-write.

## PR line (required)

```text
Write-path owner: OpenCode | Personal | Task | n/a (not a session change)
```

## Verify

```bash
pnpm check:boundaries
pnpm test:ui
```

Use `dual-runtime` in the same session when archive or Personal stores are in the diff.
