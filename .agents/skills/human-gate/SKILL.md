---
name: human-gate
description: >
  Enforce Human-gate paths, denylist, and Phase 2 credential rules. Use when
  editing package.json, pnpm-lock, apps/server/src, apps/desktop/electron,
  apps/orchestrator/src, secrets, .env, company/enterprise API, or Gateway.
display_name_zh: "Human gate 与凭据"
display_name_en: "Human Gate and Secrets"
---

# Human gate and secrets

SoT: root [`AGENTS.md`](../../../AGENTS.md) path table + Phase 2 hard constraints. Deterministic hook: [`.agents/hooks/README.md`](../../hooks/README.md).

## Trigger

Human-gate paths, lockfile / dependency changes, `.env*` / secrets, enterprise/`companyBaseUrl` calls, Gateway, or any request to relax org policy on the desktop.

## Checklist

1. **Explain before editing** Human-gate paths. L2 must not change them without the user confirming.
2. After they confirm, set `ONMYAGENT_ALLOW_HUMAN_GATE=1` so the PreToolUse hook lets the write through. Do not invent a bypass.
3. Never read or commit `.env*`, secrets, signing identities, or plaintext credentials. Public text: `pnpm check:privacy`.
4. Logged-out use must stay complete. No login wall. Without `companyBaseUrl` / company session, do not call enterprise APIs. Do not create `profiles/company` while logged out.
5. Credentials must not return to the desktop process. Desktop consumes org policy; it must not locally loosen it or grow a second control plane inside Electron.
6. Do not hand-edit `node_modules/**` or `graphify-out/**`. Refresh the graph with `pnpm task graphify build`.

## Hook overrides

| Need | How |
| --- | --- |
| User approved a Human-gate edit | `ONMYAGENT_ALLOW_HUMAN_GATE=1` |
| Bugfix after the failing test is committed | `ONMYAGENT_LOCK_TEST_EDITS=1` or `.loop/state/lock-tests` |

There is no override for secrets.

## Verify

```bash
pnpm check:privacy
pnpm check:security
```

Plus the package verify entry after any approved Human-gate edit (`pnpm task check server|desktop|orchestrator`).
