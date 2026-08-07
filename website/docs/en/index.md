---
title: OnMyAgent Introduction
---

# OnMyAgent Introduction

OnMyAgent is a **local-first office Agent workbench**. Describe a goal in natural language; it plans and runs on your machine, uses skills and tools, reads and writes your authorized workspace, and leaves checkable files—not just chat suggestions.

![Home: new task, recent sessions, and input](/images/home-session.png)

## 1. In one glance

| You want | What OnMyAgent does |
|----------|---------------------|
| Reports, notes, proposals | Say the goal and materials in a session; get document deliverables |
| Spreadsheets, reconciliation, digests | Read/write workspace sheets; open the result files |
| Scheduled briefings | **Automation** with schedules and templates |
| Role expertise | Install Experts/Skills in the **Marketplace**; chat under **Experts** |
| Your own models & keys | **BYOK**: compatible APIs or local models; credentials stay with you |

Data stays in the local workspace by default. Network access happens when you use cloud models, the marketplace, or connectors. See the Chinese handbook [安全与数据](../security) for the full boundary (EN security page will follow).

## 2. Core capabilities

| Capability | What it does |
|------------|----------------|
| **One-shot tasks** | Describe a goal on Home; the Agent plans and executes; you can add materials mid-run |
| **Local files** | Read/write authorized folders; browse, preview, and open externally in **Files** |
| **Skills & Experts** | Skills extend actions; Experts are role-scoped conversation entry points |
| **Automation** | Scheduled or trigger-based office jobs |
| **Approvals** | High-risk local actions can require confirmation |
| **BYOK models** | Bring your own API or local model |
| **Marketplace** | Browse Experts, Skills, and connectors |

## 3. How the UI is organized

Left rail switches modules; middle is lists/trees; right is chat/input (or the module body).

| Rail | Purpose |
|------|---------|
| **Home** | New task, recent sessions, welcome + composer |
| **Experts** | Installed/created experts and chats |
| **Automation** | Jobs, templates, schedules |
| **Files** | Workspace and task outputs |
| **Marketplace** | Experts / Skills / connectors |
| **Projects** | Project-scoped context (depends on version/config) |

Bottom: **Agent chat** and **Settings** (models, preferences, company, memory, system permissions, …).

### UI at a glance

![Home session](/images/home-session.png)

<p class="oma-shot-caption">Home: recent sessions and the main composer</p>

![Files](/images/files-list.png)

<p class="oma-shot-caption">Files: task outputs and workspace list</p>

![Marketplace · Experts](/images/marketplace.png)

<p class="oma-shot-caption">Marketplace · Experts: categories, search, cards</p>

::: tip Light / dark screenshots
Docs screenshots follow the handbook theme: **light** theme shows light app UI; **dark** shows dark app UI. Use the top-bar theme toggle to compare.
:::

## 4. A typical task loop

1. **State the goal** on Home or in a session (you can @ files and / skills).  
2. **Pick workspace, permission level, and model** (configure a provider in Settings first).  
3. **Run and refine** — multi-step execution; add materials or change direction.  
4. **Accept deliverables** in **Files** (preview or open externally).  
5. **Optional**: turn a stable flow into **Automation** or a **Skill / Expert**.

## 5. Typical use cases

- Work reports, meeting notes, draft proposals  
- Spreadsheet cleanup and light analysis  
- Materials for presentations  
- Scheduled digests and office automation  
- Role-based Experts and skill packs  
- (Optional) IM digital employees + org control — Chinese: [平台三分](../platform/)

## 6. Not just another chatbot

| Chat-only AI | OnMyAgent |
|--------------|-----------|
| Suggestions and draft text | **Actually runs** multi-step work on your machine |
| You copy-paste files by hand | Read/write **inside the workspace** |
| Mostly single-turn Q&A | Resumable sessions + automation |
| Results stuck in the thread | **Files** you can preview, edit outside, and archive |
| Fixed chat capabilities | Extensible via Skills, Experts, connectors |

## 7. Local-first does not mean offline-only

- **Local-first**: sessions, workspace files, and most config live on your machine.  
- **Network on demand**: cloud models, marketplace, IM/office connectors.  
- **You control the surface**: change endpoints or disable connectors to reduce egress.

## 8. Language note

This English tree is still a **skeleton**. Full guides, practices, and install docs are complete in **简体中文**.

- Chinese handbook home: [OnMyAgent 简介](../)  
- Language menu (top bar): **简体中文 / English**

More English pages will land path-by-path under `en/`.
