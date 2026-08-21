---
title: Sessions
---

# Sessions

A session, or task conversation, is a resumable office collaboration. You describe a goal; OnMyAgent's OpenCode main runtime executes in the current workspace, streams progress, and records the primary session and deliverables in the corresponding store.



## 1. Create, continue, and locate a session

| Operation | Description |
|-----------|-------------|
| Create a task | **+ New task** starts a session in the current workspace |
| Continue an old task | Select the parent task under **Recent** and confirm that it belongs to the current workspace |
| Continue across turns | Add source material, constraints, or a new direction in the same session |
| Search | Locate messages and matches inside a long conversation |
| Revert | Continue again from a selected user message; first confirm whether later branches are still needed |
| Stop | Ends the task that is currently streaming; it does not delete the session |

The session and workspace identities come from the URL. If the target workspace or session does not exist, the product should show a not-found or selection prompt instead of silently opening another item from the list.

### Recent lists parent tasks only

**Recent** lists only the parent tasks you started (**+ New task**, the Home composer, or **Add to task** from Files). Child sessions that the Agent creates for parallel work **do not** get their own row, so one job does not fill the list.

Watch subtask progress in the current conversation; see [Parallel subtasks](#parallel-subtasks). A shorter list does not mean those child sessions were deleted.

## 2. Composer

| Control | Purpose | Caution |
|---------|---------|---------|
| Attach or drag and drop | Add local files, images, and supported deliverables | A remote workspace uploads the file first; check where the copy is stored |
| Appshot | Add the current app screen as context | Check privacy and system notifications before sending |
| `@` | Reference a workspace file, directory, or context | A reference does not bypass directory permissions |
| `/` | Open commands, skills, and prompt entries | Availability depends on the installed catalog and current runtime |
| Skills, MCP, and connectors | Give the Agent additional actions | On first use, verify the account and target resource |
| Work mode | Select Ask, Craft, Plan, or another collaboration mode | In Plan mode, confirm the plan before execution |
| Model and reasoning level | Choose the model and reasoning effort for this task. Order matches Settings → Models | Providers differ in capability, cost, and context window. A model added in Settings is available when you return to Home |
| Context usage | See how much of the current window is occupied. The limit prefers the model's **catalog** context window (million-token windows show as **1M**, not 1048.6K). Occupancy splits into system prompt, tools and sub-agents, messages, skills, cache hits, and similar buckets | Near the limit, start a new task or compact the context. **Reply** and **Reasoning** are last-turn generation and are **not** part of occupancy |
| Body context menu | Select conversation body text; right-click **Cut / Copy / Paste / Select all** | Uses the system clipboard |
| Access permissions | Decide which actions run automatically and which require a prompt | Keep approvals for external sends, deletes, and sensitive writes |

## 3. Execution, Plan, and Goal

- A normal task shows streaming text, tool calls, status, and a completion reason.
- Plan mode can produce a plan first, which you then approve for execution or cancel.
- Goal can pause, resume, and clean up a longer objective; pausing does not delete files already produced.
- When the Agent needs a business decision, it can ask a single-choice, multiple-choice, or free-text question.
- For a permission request, the prompt appears immediately (you do not wait for the turn to finish). You may see **Allow once**, **Allow for session**, or a deny action; use the choices shown by the actual dialog.

Do not treat “plan generated” as task completion, and do not treat a successful tool call as proof that the final deliverable passed acceptance.

### Parallel subtasks

When the Agent splits one job into several subtasks, the timeline groups them under **N/M subtasks** (completed / total).

- Expand the group to read each subtask’s description and status (running, completed, or failed).
- Subtask return text is shown as readable body text, not a raw `task_result` wrapper.
- A failed attempt immediately retried with the same description collapses into one row.
- If you reply or the Agent adds narration in between, the next run of the same kind is a **new group** (a new turn), not merged into the previous set.

A green subtask card is not acceptance. Still check the deliverable in the next section.

## 4. Deliverables, browser, and side panel

A session can display files, diffs, images, Office documents, web pages, and browser results. Supported formats can be previewed in the app; unsupported or very large files are downloaded or passed to a system application. Markdown files written to the workspace appear as **file links** in the conversation (open the file preview), not as “open artifact” pills. HTML preview can scroll on first open. Office and PDF open from the session file path. Files written by helper scripts appear as product cards; a space session shows one card per deliverable. Home sessions stay off the Experts rail.

Recommended acceptance order:

1. In the conversation, check that the Agent claims the intended goal is complete.
2. Open the deliverables panel or [Files and deliverables](/en/guide/files).
3. Open documents, spreadsheets, presentations, audio, and video in an independent application.
4. Check the filename, format, content, references, and actual save location.
5. If the result fails acceptance, state exactly what must change in the same session.

## 5. Status, errors, and recovery

| Status | Meaning | Recommended action |
|--------|---------|--------------------|
| Running | The Agent or a tool is still working | Wait and inspect the steps; stop it if needed |
| Awaiting approval | An action is waiting for your decision | Check the command, path, and external target |
| Completed | The current run ended normally | Continue accepting the deliverable; do not rely only on the green status |
| Stopped | The user or system canceled the current run | Check for partial files |
| Model unavailable | Provider, authentication, or model catalog problem | Open [Models and BYOK](/en/guide/models) |
| Workspace not ready | Server, OpenCode, or remote connection problem | Run workspace diagnostics |
| Context limit reached | The model cannot continue with the complete context | Ask it to continue from the unfinished point, or start a new session with a summary |

After an app restart, known sessions should restore from the primary session store. If the list is briefly stale, wait for SSE synchronization or refresh it. Do not manually write a Personal Local Agent conversation into the primary Archive.

## 6. How this differs from Agent chat

| | Home session | Agent chat |
|--|--------------|------------|
| Runtime | OpenCode main track | Electron Personal Local Agent auxiliary track |
| Typical use | Workspace office tasks, primary Archive, and Server API or SSE | Direct access to local CLI or ACP Agents such as Codex, Claude Code, and Hermes |
| Storage | Server session and Archive | Personal conversation store |
| UI | May use a shared timeline appearance | May use the same timeline appearance, but does not share writable storage |

To drive a local CLI Agent directly, use [Agent chat](/en/guide/agent-chat) from the account menu. For installation, detection, and repair, see [Agent management](/en/guide/agent-management).

## 7. Recommended practices

- Keep one session focused on one deliverable, with recognizable titles and workspace names.
- Verify with a small sample and read-only permissions before expanding the file scope or scheduling Automation.
- Set explicit budgets and stop conditions for expensive models, long tasks, and external services.
- Tighten permissions before sensitive operations, then independently open or parse result files.

## 8. Related documentation

- [Your first task](/en/first-task) · [Workspaces](/en/guide/workspaces) · [Files and deliverables](/en/guide/files)
- [Agent chat](/en/guide/agent-chat) · [Approvals and permissions](/en/guide/approvals) · [Models and BYOK](/en/guide/models)
