---
title: Agent management
---

# Agent management

**Agent management** manages the fleet of Agents that OnMyAgent can connect to on this machine: discover installed CLIs, add them to **My agents**, test and repair connections, configure each Agent's **model providers**, inspect the **skill-recognition matrix**, and work with the related **session archive**.

Product navigation label: **account menu → Agent management** at the bottom left. The chat page also has **Manage agents** at the top.



## 1. Why Agent management is a separate page

| Problem | What Agent management does |
|---------|----------------------------|
| Several coding agents are installed, but their states differ | Shows health in one list and filters Offline / Needs sign-in / Not installed |
| You want to use a CLI in OnMyAgent | Add it to **My agents** so it can be selected reliably in [Agent chat](/en/guide/agent-chat) |
| A skill is installed, but an Agent cannot recognize it | The skill matrix shows which Agents recognize which skills |
| A model key must be written to one Agent's configuration | Configure and test **model providers** for that Agent (BYOK) |
| The CLI path or environment is broken | **Repair** overrides the launch command or environment, then retests |

This differs from **Market** on the main rail. Market is for installing experts, skills, and connectors; Agent management is for managing local Agent runtimes and their catalog.

## 2. Open Agent management

1. Open the **account/avatar area** at the bottom left.
2. Select **Agent management**.

You can also open it through **Manage agents** in [Agent chat](/en/guide/agent-chat), subject to the current version's UI.

## 3. Top tabs

The page commonly presents three dimensions. Follow the labels in the current product:

| Tab | Purpose |
|-----|---------|
| **Local** | The **My agents** fleet plus the **Discover** catalog; test connections, repair, and add Agents |
| **Skills** | Recognized skills and their relationship to each Agent—the skill matrix |
| **Sessions** | A session-archive/list view related to local Agents |

### Local: My agents

- **Agents under management** can be tested, repaired, and used for skills, MCP, and model configuration.
- Common installed Agents may be **automatically added**. You can also select **Add to My agents** in the Discover catalog.
- Cards commonly show health, the most recent detection time, run counts, and other summaries.

Example filters: All / Healthy / Offline / Needs sign-in / Not installed.

### Local: Discover

- The built-in **Agent catalog** primarily shows installation guidance when an Agent is missing. Once installed, you can select **Add to My agents**.
- Adding an Agent makes it selectable in Agent chat and available for skills and MCP-related configuration.

### Custom agents

- Manually register a local **CLI / ACP** Agent, including its ID, name, command, arguments, environment variables, and native skills directories.
- A saved Agent appears in **My agents** and the Local list, where it can be enabled, disabled, edited, or deleted.

### Skills tab

- Shows skills discovered on the machine or in the workspace, and which Agents recognize them.
- Use it to troubleshoot “the skill is installed, but this Agent cannot use it.” Common causes include its path, the Agent's native skills directory, or whether the Agent is under management.

### Sessions tab

- Shows a session-archive view related to local Agents and may continue history from Agent chat. Exact capabilities depend on whether the Agent supports reliable transcript recovery.

Do not confuse this session view with the OpenCode main Session Archive on Home. An unknown custom Agent does not automatically enter the main archive merely because it produced a log.

## 4. Common card actions

| Action | Description |
|--------|-------------|
| **Test connection** | Probes installation, authentication, and the ACP path. It can also run for an offline or missing Agent to aid diagnosis |
| **Add to My agents** | Adds an Agent from Discover to My agents |
| **Repair** | Overrides the launch command and environment; retest after saving |
| **Configure model providers** | Adds or edits an API URL, key, and model list for this Agent; can fetch models and test connectivity |
| **Expand details** | Shows metrics and more actions |

### Connection-result summary

| Result | Meaning |
|--------|---------|
| Connected | Ready for chat; may include the number of available models |
| Sign-in required | Complete sign-in in the corresponding CLI first |
| Not installed | The executable was not found; install it before adding it |
| Connection failed | Inspect details, then check the command, environment, network, and ACP arguments |

Finding a CLI proves only that a candidate command exists in PATH or configuration. An Agent is usable only after the executable starts, authentication completes, protocol initialization/handshake passes, and a real test request succeeds.

## 5. Model providers and BYOK

Agent management can maintain providers recognized by **each local Agent**. Opening a saved provider shows **Edit model provider**: **Connection** on the left (ID, display name, endpoint, key), **Fetch models** and the catalog on the right, and **Save changes** at the bottom. Step-by-step copy is in [Models and BYOK · Edit a model provider](/en/guide/models#2-edit-a-model-provider).

- API URL, API Key, and display name;
- A model list fetched remotely or populated manually with model IDs;
- Connection testing and per-model reachability testing;
- For Claude Code, possible role mappings such as Sonnet / Opus / Haiku to the actual request model.

This complements [Models and BYOK](/en/guide/models) in Settings. Settings primarily configures OnMyAgent's global default; Agent management primarily writes the local configuration recognized by **each Agent**.

A connection test may call the real provider endpoint and consume a small request. Use a test model and minimal quota. Never reveal an API Key, full Base URL query parameters, or sensitive account information from a response in a demo.

## 6. Capability boundaries of a custom Agent

A custom command is only a process invocation by default. It does not automatically gain ACP, streaming output, session recovery, or native approvals. Define all of the following when creating one:

- how the executable, arguments, and working directory are resolved;
- whether ACP is enabled, including its handshake and event contract;
- where environment variables come from and which values must never enter logs;
- whether the Agent natively supports the skills directory and session-recovery key;
- whether stopping a task can terminate the whole child-process tree.

Do not mark a custom Agent as fully equivalent to Codex or Claude over ACP merely because it can print a block of text.

## 7. Recommended setup order

1. Open **Agent management → Local** and check whether **My agents** already contains entries.
2. If not, expand **Discover** and select **Add to My agents** for an installed CLI. Follow the installation guide first for a missing CLI.
3. Run **Test connection** on the target Agent and resolve Needs sign-in / Not installed / Failed states.
4. If a cloud model is needed, configure a provider for that Agent and verify connectivity.
5. Open **Agent chat**, select the Agent, and start a conversation.
6. If a skill is unavailable, compare the matrix on the **Skills** tab.

## 8. Boundaries with related features

| Feature | Boundary |
|---------|----------|
| [Agent chat](/en/guide/agent-chat) | **Chat and execute** with an Agent already under management |
| [Skills](/en/guide/skills) / [Market](/en/guide/overview) | Install capability packages; Agent management shows **recognition relationships** |
| [MCP / connectors](/en/guide/mcp) | Connect external tools; can be used alongside Agent-side extensions |
| [Sessions](/en/guide/sessions) | Home's built-in assistant tasks; does not replace the local CLI Agent fleet |

## 9. Related

- [Agent chat](/en/guide/agent-chat) · [Models and BYOK](/en/guide/models) · [Approvals and permissions](/en/guide/approvals)
- [Archive, search, and import](/en/guide/archive) · [Interface and workspaces](/en/guide/overview) · [Security and data](/en/security)
