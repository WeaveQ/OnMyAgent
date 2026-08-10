---
title: Automation
---

# Automation

Automation runs office work on a **schedule**, including daily and weekly reports, reminders, and summaries, without requiring you to open a session manually every time.


## 1. Interface structure

| Area | Purpose |
|------|---------|
| **Auto** on the main rail | Opens Automation |
| Middle column | **All tasks**, **Recommended cases**, and the list of scheduled tasks you created |
| Right side | Current task details: enabled state, prompt, run time, and run count |
| Top bar | **+ Add** and **Add from cases** |

## 2. Good use cases

- Summarize action items or a business briefing every workday morning
- Create a draft weekly report every Friday
- Check at a fixed time whether a class of files has changed

## 3. Create an Automation

1. Open **Auto** on the main rail.
2. Choose **Add from cases** or **+ Add**.
3. Enter a name and prompt. Rewrite the starter content of a case for your actual workspace and goal.
4. Choose the frequency, time zone, and start or end date when needed.
5. Bind the workspace, model, Agent, skills, and access permissions.
6. Select a fixed output location. Keep human approval for the first runs so a new Automation cannot send externally without review.
7. Save and enable it, then select **Test run** once to verify the complete path.

## 4. Frequency and time semantics

| Type | Use | Caution |
|------|-----|---------|
| Once | Run once at a specific time | A missed time is not retried indefinitely |
| Interval | Repeat after a fixed duration | Confirm that the rate will not create excessive cost or message noise |
| By cycle | Select weekdays and a time | The configured time zone and device sleep affect the trigger |

A normal recurring task has only a limited claim grace period after it becomes due. In the current runtime, that window is approximately two minutes after the scheduled time. A run may be missed if the computer is shut down or deeply asleep, the Server is stopped, or another task blocks execution for too long.

Automation is not a cloud service with guaranteed delivery. If strong scheduling guarantees are required, run the Orchestrator and Server on a continuously available managed machine and monitor the real run history.

## 5. Model, Agent, and permissions

- Select a working model for the task, or make sure the workspace default model is available.
- Use an Agent-and-Skill combination that has already completed the same prompt in a normal session.
- Permission mode controls file writes, commands, external sends, and approvals. Unattended execution does not mean Full Access is appropriate.
- The bound workspace determines the file scope. Do not rely on a path that exists only on another machine.

## 6. Test run, stop, and pause

| Operation | Effect |
|-----------|--------|
| Test run | Creates one real run immediately without changing the future schedule |
| Stop current run | Cancels the active occurrence; the schedule can remain enabled |
| Pause or disable the schedule | Prevents new scheduled occurrences; it does not necessarily terminate a run already in progress |
| Resume | Allows future scheduled occurrences again |
| Archive | Removes the task from the primary list; the confirmation dialog defines history retention and deletion boundaries |

If a task has already written part of a file, inspect the partial result after stopping it. Do not assume the system rolls it back automatically.

## 7. Run directories, history, and timeouts

Each Server Automation run creates a dedicated task directory and writes task instructions, execution results, and related records. Waiting for a single task has an upper bound of about two hours in the current runtime. A timeout does not prove that the underlying process ended safely; inspect both its status and deliverables.

In run history, verify the scheduled time, actual start and end times, model and Agent, completion status, error, and deliverables. For file-based results, independently open the output in [Files and deliverables](/en/guide/files).

## 8. Risks and common problems

| Symptom | What to check |
|---------|---------------|
| It did not run on time | Whether the Server stayed up, device sleep, schedule time zone, and whether the claim grace window was missed |
| Save reports a missing model | Whether the bound or default model still exists and its Provider authentication is valid |
| It runs indefinitely or times out | Agent active run, an approval waiting for input, an external tool, or the network |
| Run succeeds but the expected file is absent | Prompt, output path, workspace ownership, and the execution result file |
| It sends duplicate messages | Schedule frequency, retries, and whether two instances are running the same task |

For external sends, deletes, publishing, real cloud data, or paid APIs, start with a test account and a small sample. Relax the scope gradually only after the flow is stable.

## 9. Recommendations

- Run the identical prompt manually in a normal [session](/en/guide/sessions) before scheduling it.
- Keep the output path fixed so results are easy to find and diff.
- Record the expected deliverable, maximum run time, failure notification, and manual takeover procedure.
- Pair external or higher-risk actions with [Approvals and permissions](/en/guide/approvals).

## 10. Related documentation

- [Scenario: scheduled summaries](/en/scenarios/automation-digest) · [Sessions](/en/guide/sessions) · [Files and deliverables](/en/guide/files)
- [Messaging channels](/en/guide/channels) · [Remote runtimes and sandboxing](/en/guide/remote-runtime)
