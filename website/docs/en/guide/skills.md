---
title: Skills
---

# Skills

A Skill is an installable **capability pack**. It wraps tool calls, workflows, or specialized prompts so an Agent can perform a concrete action under authorization, such as reading the web, processing office files, or creating Automation.

This guide explains how to install and invoke Skills, and what common browser, office, search, and skill-discovery capabilities are **called and how they work** in OnMyAgent.

## 1. Where to manage Skills

1. Open **Market** on the main rail.
2. Switch to the **Skills** tab in the top bar.
3. Browse, search, and install. Some Skills are **built in or bundled** and become available after installation.


You can also enter **`/`** in a conversation composer to open skills and commands.

## 2. How to invoke a Skill

| Method | Description |
|--------|-------------|
| Natural language | State the goal, such as “open this page and create a screenshot summary”; the Agent matches installed capabilities |
| `/` command | Name a Skill or workflow explicitly |
| Find before acting | Use a **Find Skills** capability to ask which Skill fits the task |

**Recommendation:** install only from trusted sources, pair sensitive actions with [Approvals](/en/guide/approvals), and test on a small scope before batch processing.

---

## 3. Common capability map

The table maps task types to **current OnMyAgent product capabilities**, whether they are bundled Skills, Market plugins, or equivalent product paths.

| Task type | Purpose | OnMyAgent equivalent | Status | How to use it |
|-----------|---------|----------------------|--------|---------------|
| **Browser interaction** | Open, scroll, click, capture screenshots, and read pages | **browser-automation** for the in-app browser plus **browser-skill** for local Chrome or Edge with an extension | ✅ Available through two paths | See [Browser and Computer Use](/en/guide/browser-computer-use) |
| **Office documents** | Read, write, and generate PDF, DOCX, PPTX, and XLSX | **document-processing** plus **pptx**, with optional **OfficeCLI** plugin | ✅ Available | See “The office document suite” below |
| **Speech transcription** | Convert local speech to text | No bundled Skill with the same name; use a connector, external ASR, or Market Skill | ⚠ No equivalent built in | Transcribe first, then use [Reports and meeting minutes](/en/scenarios/office-docs) |
| **Video download** | Download video, audio, or subtitles and summarize | No equivalent bundled Skill; observe copyright and platform terms | ⚠ No equivalent built in | Summarization can operate on a local file you already have; do not scrape copyrighted media by default |
| **Web search** | Search before organizing information | Depends on a model with web access, or a search service under **MCP / Connectors** | ⚠ Not one bundled Skill name | See “Web search” below |
| **Local knowledge base** | Read and write a notes directory | Point a workspace at the notes library; memory and local Markdown remain editable | △ Equivalent path | Use the library as a workspace or `@` path; see [Memory](/en/guide/memory) |
| **Skill security** | Review a third-party Skill before installation | Market and source notices; no independently bundled scanner | △ Partial | Prefer trusted sources and use [Approvals](/en/guide/approvals) for higher-risk actions |
| **Self-improvement** | Record preferences and corrections | **self-improving** plus [Personal and memory](/en/guide/memory) | ✅ Available | After a correction, record the preference in memory |
| **Visual or page design** | Create a poster or a visually polished page | **canvas-design** plus frontend work in a session | ✅ Related capability | Use for event posters and landing pages |
| **Find a Skill** | Recommend a Skill for a task | **find-skills** | ✅ Available | Ask “Find a Skill for web collection and screenshots” |

> “✅” means the capability is available, “△” means another path covers it, and “⚠” means there is no bundled equivalent today. The actual **Market · Skills** list in your client is the source of truth.

---

## 4. Browser capabilities

Web automation is split across two surfaces in OnMyAgent so that their boundaries remain clear:

| Skill ID | Surface | Best for |
|----------|---------|----------|
| **browser-automation** | The **in-app browser** in the right-side Browser panel | In-app preview without relying on a local Chrome sign-in |
| **browser-skill** | Local **Chrome or Edge** plus the `bsk` extension | Websites that require an existing signed-in session and real cookies |
| **computer-use** | Native desktop application UI | Operating a local app; this is **not** web automation |

### How to use it

1. Confirm that the relevant Skill is enabled. If Market or Extensions shows a **BrowserSkill** setup guide, complete its three steps.
2. State the goal in a session, for example:

```text
Use the in-app browser to open https://example.com. Expand and scroll through
the content required for a complete reading, create a structured summary,
and save screenshots of the key areas with notes/web-summary.md in the workspace.
```

3. If the site requires your local sign-in, use **browser-skill** and state: “Use the signed-in session from my local Chrome.”
4. When a direct API can complete the work, prefer a [connector or MCP](/en/guide/mcp) instead of forcing browser clicks.

### Example prompt

```text
Open this page, read all content that requires expansion or scrolling,
turn it into a structured summary, and save screenshots of the key areas.
```

### Cautions

- The in-app browser does **not** expose an operational path for arbitrary connections to CDP port 9222. Follow the Skill's official tool instructions.
- Complete sign-in, CAPTCHA, and other human steps in the browser when prompted, then continue.
- Higher-risk clicks and submissions remain subject to [permissions and approvals](/en/guide/approvals).

---

## 5. The office document suite

For PDF, Word, PowerPoint, and Excel work:

| Capability | OnMyAgent |
|------------|-----------|
| Unified entry | **document-processing**, which routes Word, Excel, CSV, PowerPoint, and PDF tasks |
| Presentations | **pptx**, for creating, parsing, editing, merging, and splitting presentations |
| Enhanced runtime | Optionally install the **OfficeCLI** plugin, an office runtime under Market or Settings that takes precedence over the lightweight runtime |

### Examples

```text
Clean duplicate rows in accounts-receivable-template.xlsx in the workspace,
summarize amounts by customer, and save the result as notes/accounts-receivable-summary.xlsx.
```

```text
Create a presentation of no more than ten slides from notes/proposal-outline.md.
Save it as deliverables/proposal-deck.pptx.
```

See [Files and deliverables](/en/guide/files) for acceptance.

---

## 6. Web search

When no bundled Skill is named `web-search`:

1. Use a model that supports web access under [Settings · Models](/en/guide/models).
2. Or connect a search MCP under **Market → Connectors**.
3. When complete information requires opening a page, use [Browser and Computer Use](/en/guide/browser-computer-use).

```text
Research 2026 developments in office Agent products, summarize the key points
with source links, and write the result to notes/research/agent-news.md.
```

---

## 7. Find Skills, self-improvement, and design

| Need | Skill or capability | Example |
|------|---------------------|---------|
| You do not know what to install | **find-skills** | “I need web collection and screenshots. Find suitable Skills and explain the differences first.” |
| Improve personalization over time | **self-improving** plus [Personal and memory](/en/guide/memory) | Record a corrected preference in memory |
| Poster or visual design | **canvas-design** | “Create an event poster in a modern professional style.” |
| Structured document writing | **doc-coauthoring** | Collaborate on PRDs, proposals, and decision documents |
| Create or edit a Skill | **skill-creator** | Create and evaluate a custom Skill |
| Scheduled work | **create-automation** | “Create a draft weekly report every Friday” → [Automation](/en/guide/automation) |

---

## 8. Other commonly bundled Skills

In addition to the map above, an app package commonly includes:

| Skill | Purpose |
|-------|---------|
| **expert-manager** | Create and validate expert packages |
| **computer-use** | Control local desktop applications, not web pages |
| **tencent-docs** | Read and write Tencent Docs with authorization |
| **tencent-meeting-skill** | Tencent Meeting and meeting-minutes capabilities with authorization |
| **wecom-unified** | WeCom documents, messages, calendars, and related capabilities; requires its CLI |
| **qcc-company** | Qichacha company information through a connector |
| **weather** | Weather lookup |

Use the **Market · Skills** list in your current client as the source of truth; the catalog can vary between versions.

---

## 9. Related documentation

- [Experts](/en/guide/experts) · [MCP and connectors](/en/guide/mcp) · [Approvals](/en/guide/approvals) · [Files](/en/guide/files) · [Automation](/en/guide/automation)
- [Scenario usage guide](/en/scenarios/usage-guide) · [Practice examples](/en/scenarios/practice/) · [Your first task](/en/first-task)
