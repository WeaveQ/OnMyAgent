---
title: Introduction to OnMyAgent
---

# Introduction to OnMyAgent

OnMyAgent is a **local-first office Agent workbench**. Describe a goal in natural language and it will plan on your machine, call skills and tools, read and write the authorized workspace, and leave verifiable results in files—not merely offer suggestions in chat.

![Home: new task, recent sessions, and input](/images/home-session.png)


## 1. OnMyAgent in one sentence

| What you need | How OnMyAgent handles it |
|---------------|--------------------------|
| Reports, minutes, and proposals | State the goal and source materials in a session; the Agent produces document deliverables |
| Spreadsheet cleanup, reconciliation, and summaries | Read and write sheets inside the workspace, then deliver a result file you can open |
| Scheduled briefings and reminders | Use **Automation** to schedule a repeatable prompt or template |
| Role-specific expertise | Install an expert or skill from **Market**, then work with it from **Experts** on the main rail |
| Control over models and keys | **BYOK**: connect a compatible API or a local model; you keep the credentials |

Data stays in the local workspace by default. Network access occurs only when a connected model, Market item, or connector needs it. For the complete boundary, see [Security and data](/en/security).

## 2. Core capabilities

| Capability | Description |
|------------|-------------|
| **Delegate in one sentence** | Describe a goal in a Home session; the Agent breaks it into steps and executes them, while letting you add materials mid-run |
| **Local files** | Read, write, and import within an authorized workspace; browse by type, preview, and edit externally from Files |
| **Skills and experts** | A Skill extends what an Agent can do; an expert is a role- and scenario-specific conversation entry point |
| **Automation** | Run scheduled or triggered office tasks such as reports, reminders, and summaries |
| **Approvals and permissions** | Require confirmation before higher-risk actions on your machine continue |
| **Model choice (BYOK)** | Connect a compatible API or local model; you control the keys and endpoints |
| **Market** | Browse and install experts, skills, and connectors, including office components and IM bots |

## 3. Finding your way around

The left main rail switches between primary modules. The middle column shows a list or directory, and the right side contains the conversation and composer—or the current module's main content.

| Main rail item | What it does |
|----------------|--------------|
| **Home** | Start a new task, reopen recent sessions, and use the welcome composer |
| **Experts** | Browse installed or created experts and their conversations |
| **Automation** | Manage automation tasks, cases, and schedules |
| **Files** | Browse workspaces and task deliverables; filter, search, and preview |
| **Market** | Browse experts, skills, and connectors |

The account menu at the bottom opens **Agent management**, **Agent chat**, and **Settings** for models, preferences, Company, memory, system permissions, and more. **Projects** is no longer on the main rail; the Files Projects tab remains a preview. See [Projects preview](/en/guide/projects).

### Interface at a glance







![Home session](/images/home-session.png)

<p class="oma-shot-caption">Home: recent sessions and the main composer</p>

![Files](/images/files-list.png)

<p class="oma-shot-caption">Files: task outputs and workspace list</p>

![Marketplace · Experts](/images/marketplace.png)

<p class="oma-shot-caption">Marketplace · Experts: categories, search, cards</p>

::: tip Light / dark screenshots
Docs screenshots follow the handbook theme: **light** theme shows light app UI; **dark** shows dark app UI. Use the top-bar theme toggle to compare.
:::

## 4. What happens during a task

1. **State the goal**: describe what you need in Home or the session composer. You can reference files with `@` and invoke skills with `/`.
2. **Choose authorization and a model**: select the workspace, permission level, and model. On first use, connect a provider in Settings.
3. **Execute and refine**: the Agent works through multiple steps; you can add materials, redirect it, or ask for another version.
4. **Accept the deliverable**: open it from **Files**, preview it, or edit it in a system application. If it is not good enough, continue the same session with concrete corrections.
5. **Make it repeatable** (optional): turn a stable workflow into an **Automation**, a **Skill**, or an **expert**.

For detailed instructions, see [Your first task](/en/first-task) and [Scenario usage guide](/en/scenarios/usage-guide).

## 5. Where it fits

### Everyday office work

Work reports, meeting minutes, proposal drafts, scheduled summaries, and reminder automations.

### Data and spreadsheets

Spreadsheet cleanup, reconciliation, and lightweight analysis, with results saved as files you can open.

### Presentations and supporting material

Organize presentation materials, or turn key points into an outline or asset pack.

### Role experts

Install experts and skill packs for specific roles, then collaborate continuously from Experts on the main rail.

### Organization extensions (optional)

Digital workers for Feishu, DingTalk, and similar services, plus organization-side governance. See [The three-product platform](/en/platform/).

## 6. How this differs from an AI that only chats

| Chat-only AI | OnMyAgent |
|--------------|-----------|
| Offers advice or draft text | **Actually executes** multi-step work on your machine |
| Requires manual file copy and paste | Reads, writes, imports, and delivers **inside the workspace** |
| Focuses on single-turn questions | Supports resumable sessions and Automation |
| Leaves results scattered through chat | Provides files that can be previewed, edited externally, and archived from **Files** |
| Has capabilities fixed to the chat window | Extends actions with skills, experts, and connectors |

## 7. Local-first does not mean offline-only

- **Local-first**: session state, workspace files, and most configuration stay on your machine by default.
- **Network when needed**: cloud models, Market, and IM or office connectors access their corresponding services.
- **You can turn it off or change the source**: switch model endpoints or stop using a connector to reduce external access.

If your organization needs to distinguish the personal workbench, digital workers, and organization governance, start with [The three-product platform](/en/platform/).

## 8. Recommended reading order

1. [Quickstart](/en/quickstart) — install and complete the first run
2. [Your first task](/en/first-task) — go from one sentence to a deliverable
3. [Scenario usage guide](/en/scenarios/usage-guide) — the general workflow, formula, iteration loop, and selection guidance
4. [Tips for working efficiently](/en/guide/efficient-tips) — ten habits for getting started
5. [Practice examples](/en/scenarios/practice/) — end-to-end examples for files, documents, spreadsheets, Automation, and more
6. [Interface and workspace](/en/guide/overview) · [Agent chat](/en/guide/agent-chat) · [Agent management](/en/guide/agent-management) · [Skills](/en/guide/skills) · [Security and data](/en/security)

The site landing page is one level above the handbook (the site root `/` locally, or the repository root URL on GitHub Pages).
