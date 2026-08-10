---
title: Agent chat
---

# Agent chat

**Agent chat** is a dedicated chat entry for local **CLI / ACP Agents**. It lets you assign tasks directly to Claude Code, Codex, OpenCode, OpenClaw, Hermes, and custom Agents from OnMyAgent, rather than using the general session path on Home.

Product navigation label: **account menu → Agent chat** at the bottom left.



## 1. How Agent chat differs from Home sessions

| | Home [sessions](/en/guide/sessions) | **Agent chat** |
|--|-------------------------------------|----------------|
| Conversation target | OnMyAgent's built-in office assistant | An installed/configured **local Agent** (CLI/ACP) |
| Typical use | Assign everyday office work in one sentence, read/write a workspace, and use installed skills or experts | Use a local coding agent or specialist CLI for development, troubleshooting, scripts, and long-running work |
| Context | Task-session list (recent tasks) | **Sessions per Agent**; switching Agent changes the context window |
| Entry | **Home** on the main rail | **account menu → Agent chat** |

Both paths run locally and may write files. They differ in **who executes**, the transport, and the persistence source of truth. The timeline UI can be shared, but Personal conversations must not write into OpenCode's main Session Archive.

## 2. Open Agent chat

1. Select the **account/avatar area** at the bottom left, usually above the gear.
2. Select **Agent chat**.

From Agent chat, select **Manage agents** to open [Agent management](/en/guide/agent-management), repair a connection, or inspect the skill matrix.

## 3. Interface structure

| Area | Purpose |
|------|---------|
| **Agent list / selector** | Select a local Agent; filter Available / Offline / Needs login / Not installed |
| **Conversation list** | Multiple conversations under the selected Agent; create a **New conversation** or continue history |
| **Main conversation** | Message timeline, run state, and artifact entries |
| **Composer** | Send tasks to the local Agent; supports line breaks and model selection when the Agent supports an override |
| **Status** | Online / Offline / Needs login / Not installed; use **Test connection** or redetect |

Common detection targets include **OpenCode, Codex, OpenClaw, and Hermes**. A slow probe does not block every other result indefinitely.

## 4. What you can do

| Action | Description |
|--------|-------------|
| Select an Agent and chat | Select an online Agent before sending work; the window shows only that Agent's conversation context |
| Create or switch conversations | Keep separate topics in separate conversations under one Agent |
| Send a task | Describe the goal in natural language and bind a workspace directory through the current UI |
| Switch model | If the Agent supports model override, change the target model in the page |
| Approve | When the underlying Agent requests approval, choose **Allow once**, **Allow for session**, or **Decline** |
| Inspect artifacts | Open file changes from the run result, then validate them again under [Files](/en/guide/files) |
| Scheduled tasks | Some Agents can send a fixed prompt to the **currently selected conversation** at an interval, like a heartbeat |

### Provider capability differences

Do not promise the same capabilities for every Agent:

| Agent / method | Current important limitation |
|----------------|------------------------------|
| Codex / Claude Code over ACP | Usually supports streaming, sessions, and native approvals; still depends on the installed version and local sign-in |
| OpenCode Personal adapter | Its current capability table does not promise streaming; it is not a replacement for the OpenCode main path on Home |
| OpenClaw | Can stream and resume, but does not provide equivalent native approvals |
| Hermes | Supports ACP, but does not currently promise reliable resume; a later turn may create a new session |
| Custom command | No ACP, streaming, resume, or native approvals by default; it receives those capabilities only when explicitly configured for ACP |

An **Online** status or discovered executable does not prove that all of these capabilities work. Run Test connection and one harmless real task with the target Agent.

### Approval modes

The local-Agent side commonly offers these policies. Follow the labels in the current product:

| Mode | Meaning |
|------|---------|
| **Auto approve** | Automatically approves the Agent's native permission requests; use only in an isolated test or a clearly controlled low-risk task |
| **Ask on native requests** (recommended default) | Prompts only when the underlying Agent emits a permission request |
| **Auto for read-only** | Automatically approves clearly read-only requests; writes, commands, and higher-risk requests still ask through the native approval flow |

See [Approvals and permissions](/en/guide/approvals) for the broader permission and confirmation model.

### Active runs and bound scheduled tasks

- If a conversation already has an active run, a new message may ask you to wait, check status, or stop the previous run first.
- Stopping the current run does not delete the conversation and does not guarantee rollback of files already written.
- A bound scheduled task must preserve the current conversation identity and execute the latest pending intent when due. Saving only a conversationId does not prove correct execution.
- Before leaving a task unattended, use **Run now** once to verify real output and approval behavior.

## 5. Recommendations

1. **Verify Agent health first.** If it is Offline or Needs login, use [Agent management](/en/guide/agent-management) to test, sign in, or repair it.
2. **Keep one goal per conversation.** Give a long-running task its own conversation so archiving and scheduled-task binding remain clear.
3. **Tighten permissions for the task.** Use an ask-style mode before writing to a repository, installing dependencies, or changing system configuration.
4. **Validate artifacts under Files.** Do not rely only on a summary inside the chat bubble.
5. **Separate it from Home.** Prefer Home sessions for everyday office work; use Agent chat when a local coding CLI must execute the task.

## 6. Common states

| State | Meaning | Recommendation |
|-------|---------|----------------|
| Online / Healthy | Ready for chat | Send the task |
| Offline | Cannot establish an ACP/CLI session | Check environment, network, and configuration, then retest |
| Needs login | CLI is not authorized | Sign in through that CLI, then redetect |
| Not installed | Executable not found | Follow the installation guide, then add it to management |
| Discovered but unavailable | Command exists in PATH, but authentication or ACP handshake failed | Test connection and inspect redacted diagnostics |
| Resume unsupported | Provider does not provide reliable transcript/resume | Start a new conversation and include the necessary summary |

## 7. Related

- [Agent management](/en/guide/agent-management) — fleet membership, skill matrix, model providers, and repair
- [Sessions](/en/guide/sessions) — general tasks on Home
- [Models and BYOK](/en/guide/models) · [Approvals and permissions](/en/guide/approvals) · [Archive, search, and import](/en/guide/archive)
- [MCP and connectors](/en/guide/mcp) · [Automation](/en/guide/automation)
