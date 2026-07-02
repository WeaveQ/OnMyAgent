---
name: agent-browser-core
description: OpenClaw skill for the agent-browser CLI (Rust-based with Node.js fallback) enabling AI-friendly web automation with snapshots, refs, and structured commands.
description_zh: "基于 agent-browser CLI 的 AI 友好型网页自动化"
description_en: "AI-friendly web automation via agent-browser CLI with snapshots & refs"
version: 1.0.2
allowed-tools: Bash
display_name: "网页自动化"
tags:
  - web-automation
  - browser
  - scraping
  - ui-interaction
display_name_en: "Agent Browser Core"
visibility: "public"
---

# Agent Browser Skill (Core)

## Purpose
Provide an advanced, production-ready playbook for using agent-browser to automate web tasks via CLI and structured commands.

## Quick orientation
- Read `references/agent-browser-overview.md` for install, architecture, and core concepts.
- Read `references/agent-browser-command-map.md` for command categories and flags.
- Read `references/agent-browser-safety.md` for high-risk controls and safe mode rules.
- Read `references/agent-browser-workflows.md` for recommended AI workflows.
- Read `references/agent-browser-troubleshooting.md` for common issues and fixes.

## Required inputs
- Installed agent-browser CLI and browser runtime.
- Target URLs and workflow steps.
- Session or profile strategy if authentication is required.

## Expected output
- A clear command sequence and operational guardrails for automation.

## Operational notes
- Snapshot early, act via refs, then snapshot again after DOM changes.
- Use `--json` for machine parsing and scripting.
- Use waits and load-state checks before actions.
- Close tabs or sessions when done to release resources.

## Safe mode defaults
- Do not use `eval`, `--allow-file-access`, custom `--executable-path`, or arbitrary `--args` without explicit approval.
- Avoid `network route`, `set credentials`, and cookie/storage mutations unless the task requires it.
- Allowlist domains and block localhost or private network targets.

## Security notes
- Treat tokens and credentials as secrets.
- Avoid `--allow-file-access` unless explicitly required.

## Session & auth playbook
- **Session Isolation**: By default, `agent-browser` launches an independent browser instance and does NOT share the user's existing login sessions.
- **Reusing Profiles**: Use `--user-data-dir` to persist and reuse login states across runs.
- **Connecting to Existing Chrome**: Use `--cdp` to attach to an already running Chrome instance (useful for bypassing complex auth).
- **Auth Fallback**: For complex OAuth or Cloudflare CAPTCHA scenarios that block automation, immediately hand-off to the user for manual intervention rather than infinitely retrying.

## Complex task orchestration
- **Step-by-Step Execution**: For complex tasks (e.g., batch downloads, multi-page scraping, complex forms), first output a clear plan, then execute step-by-step, reporting the result of each step before proceeding.
- **Pacing and Human-likeness**: Control operation pacing. Introduce random delays or simulate human input speed to avoid triggering anti-bot mechanisms.
- **Sensitive Operations**: Explicitly ask for user confirmation before executing sensitive actions such as entering passwords, initiating batch downloads, or deleting data.

## Result verification
- **Data Validation**: If scraped or extracted fields return empty, zero (`0.00`), or abnormal values, proactively prompt the user to confirm the data source or page state.
- **Write Operation Re-check**: After executing any write operation (click, fill, submit), you MUST re-snapshot or use `get` to verify the DOM state has actually changed.
- **No Fake Completions**: Strictly prohibited to output "Task Completed" or "Updated Successfully" if the underlying data or page state has not substantively changed.
