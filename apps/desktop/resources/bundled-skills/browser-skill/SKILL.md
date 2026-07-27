---
name: browser-skill
description: >
  Drive the user's real Chromium browser (Chrome/Edge logins and cookies) through the
  external Tencent BrowserSkill `bsk` CLI and extension. Use for logged-in sites, form
  flows, page reads, and human-in-the-loop captcha/login handoff. Prefer purpose-built
  MCP connectors or OnMyAgent in-app Browser (browser-automation) when they fit better.
  Requires `bsk` on PATH and the BrowserSkill extension connected (green popup).
---

# BrowserSkill (external real browser)

Use the **external** BrowserSkill stack (`bsk` CLI + Chrome/Edge extension). This is **not**
OnMyAgent's in-app browser (`browser-automation` / `onmyagent_browser_node_repl`) and **not**
Computer Use (desktop AX).

## When to use

- Sites the user is **already signed into** in Chrome/Edge
- Navigate, snapshot, click, fill, screenshot against a **real browser profile**
- Captcha / OTP / payment confirmation via `bsk request-help`

## When NOT to use

- Pure desktop app control → Computer Use skill
- In-app webview / agent browser tools already available → `browser-automation`
- Files, APIs, shell-only tasks with no browser
- Credential harvesting (`bsk evaluate` on banking/SSO pages)

## Prerequisites

1. `bsk` installed (`bsk --version`, `bsk doctor`)
2. BrowserSkill extension loaded; popup green
3. User can open install docs from OnMyAgent Settings → Extensions → BrowserSkill

Setup (user machine):

```bash
curl -fsSL https://raw.githubusercontent.com/Tencent/BrowserSkill/main/install.sh | sh
bsk doctor
# Install extension: Chrome Web Store "BrowserSkill"
```

## Mandatory lifecycle

```
1. bsk session start                 → capture 4-letter session id
2. every command: --session <id>
3. bsk session stop <id>             → REQUIRED (even on error)
```

Emergency: `bsk session stop --all`

## Core loop

```
bsk navigate <url> --session <id>
bsk snapshot --session <id>          → aria tree with @e1, @e2 refs
bsk click @e3 --session <id>
bsk fill @e4 --value "…" --session <id>
bsk snapshot --session <id>          → re-snapshot after DOM change
```

Refs invalidate after navigation — always re-snapshot before the next interaction.

## Observation priority

1. `bsk snapshot` — default
2. `bsk get-html` — only if snapshot is insufficient
3. `bsk screenshot` — visual layout only when needed

## Stop when the goal is met

Bounded goals only. When success is observed, `bsk session stop` immediately.
No post-success wandering. On captcha/login blocks: `bsk request-help`, do not brute-force.

## Red lines

1. No token theft via `evaluate` on sensitive sites
2. No long borrow of personal tabs across unrelated tasks
3. Always `session stop`
4. Prefer OnMyAgent workspace artifacts (screenshots, notes) over dumping secrets into chat

## Docs

- Upstream: https://github.com/Tencent/BrowserSkill
- Any command: `bsk <cmd> --help`
