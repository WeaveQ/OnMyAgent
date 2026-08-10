---
title: Tips for working efficiently
---

# Tips for working efficiently: 10 habits

These ten high-frequency habits help new users turn the interface and capabilities of **OnMyAgent** into a reliable way of working.

In one sentence: learn these habits to move faster from a **vague idea → executable task → verifiable workspace deliverable**.

## Who this is for

- You are using OnMyAgent for the first time and are unsure how to delegate work
- You already use it, but the quality varies from run to run
- You want it in your daily workflow instead of using it only for occasional questions

Complete the [Quickstart](/en/quickstart) and [Your first task](/en/first-task) first, then return here to reinforce the habits.

The main interface, including the left rail, recent tasks, central conversation, and composer:


---

## 1. Make the task explicit: what, inputs, and quality

Do not make the Agent guess your intent. Use three elements:

| Element | What to specify | How to express it in OnMyAgent |
|---------|-----------------|--------------------------------|
| **What** | The goal and deliverable | “Organize this into a table” or “write it to this path” |
| **Inputs** | Where the materials are | [Import files](/en/guide/files), then reference them with `@`, or provide a workspace-relative path |
| **Quality** | Format, audience, length, and exclusions | “Use a table, omit an introduction, write in English” |

**Weak:** Help me organize the notes from our last meeting.

**Better:**

```text
Turn workspace file notes/0320-product-review.md, or @that file, into a checklist:
1. the decision for each topic; 2. owner and deadline; 3. disputed or unresolved items.
Use a table, write it to notes/0320-action-items.md, and omit the introduction.
```

**Tip:** If you are unsure, ask “I want to do X. What information do you need from me?” before starting the actual execution.

---

## 2. Work in small increments

Dropping an entire large task into one prompt often creates a long result that drifts from the goal. Break it into verifiable increments.

**Weak:** Read a 50-page report, make a deck, and email it to my manager.

**Better, in three rounds:**

1. Read `reports/industry.pdf` and extract five conclusions with page numbers.
2. Use those conclusions to produce a 15-slide presentation **outline**.
3. After I approve the outline, expand one slide at a time or create the [presentation](/en/guide/skills).

Open each deliverable from [Files](/en/guide/files) before moving to the next step.

---

## 3. Refine the first result

A conversation is multi-turn by default. Common ways to adjust a result include:

- Be direct: “too long,” “too formal,” or “rewrite the third paragraph”
- Ground it in a situation: “write to a long-time collaborator in a casual chat tone”
- Add constraints such as the audience, word count, and format
- Change perspective to a manager, customer, or analyst

Use an [expert](/en/guide/experts) to keep a role stable, or record permanent rules under [Personal and memory](/en/guide/memory).

---

## 4. Start on the desktop, then go remote

1. **Start in the desktop app**, where you can watch the execution, approval dialogs, and file destination.
2. Once you understand the behavior, consider unattended Automation or external IM access if your environment is connected.
3. For move, delete, or archive operations, first ask: “List the proposed operations and wait for my confirmation before executing.”

Example:

```text
List the files under workspace downloads/ and group them by type.
Then propose a move plan: pdf → notes/archive/pdf and xlsx → notes/archive/xlsx.
Wait for my confirmation before executing. Do not change anything yet.
```

See [Approvals and permissions](/en/guide/approvals) for higher-risk actions.

---

## 5. Give it a role with experts

- Install a role expert from Market, or [create an expert](/en/guide/experts).
- Describe a domain-specific goal instead of saying only “write something.”
- Keep expert conversations separate from Home tasks so their contexts do not get mixed.

See [Experts](/en/guide/experts).

---

## 6. A good example beats a pile of requirements

When tone, layout, or structure is difficult to explain, **provide a sample you like**.

```text
Use the structure and tone of @notes/weekly-report-good-sample.md.
Create this week's report from the content under notes/daily/,
and save it to notes/weekly/this-week.md.
```

Alternatively, invoke an installed [Skill](/en/guide/skills) with `/` to make the workflow repeatable.

---

## 7. Open more tasks instead of fighting a polluted context

| Habit | In OnMyAgent |
|-------|--------------|
| One subject per session | Use **+ New task** on Home, or **+ New conversation** under an expert |
| Separate proposals, spreadsheet cleanup, and email | Run multiple tasks without contaminating one another |
| If the conversation starts drifting | Start a new task with five lines of background plus the key files referenced with `@` |

You can also review context compaction and automatic new-task preferences under [Settings · Preferences](/en/guide/settings).

---

## 8. Back up before letting an Agent change files

An Agent can change more than you intended. A mature workflow is **reversible**:

- Before changing an important document, copy it to `name-backup-date`.
- By default, ask the Agent to **save a new file** instead of overwriting the original; make this explicit in the prompt.
- When needed, use [Archive](/en/guide/settings#archive) and your normal workspace versioning practices.

```text
Create a shorter external version of @proposal.docx.
Save it as proposal-external-short.docx and do not overwrite the original.
```

---

## 9. Use Automation for repetitive work

1. First, run the same prompt **manually** in a normal session.
2. Open **Auto** on the main rail, then choose **Add** or **Add from cases**.
3. Fix the schedule and output path explicitly.

Good uses include a daily briefing, Friday weekly report, and fixed inspection. See [Automation](/en/guide/automation) and the [scheduled summary scenario](/en/scenarios/automation-digest).

```text
Every Friday at 17:00, summarize this week's relevant Markdown files under notes/
and create a draft weekly report under notes/weekly/.
```

---

## 10. Automate the mechanical work and use roles to improve quality

- **Automate responsibly:** give spreadsheet formatting, field normalization, template application, and batch renaming to the Agent plus [office skills](/en/guide/skills).
- **Raise quality deliberately:** provide a role and a standard, such as “use the standards of an excellent research report; mark assumptions wherever data is missing,” rather than saying only “make it better.”

Keep your attention on **decisions and judgment**; delegate execution and organization wherever possible.

---

## Recommended learning order

| Order | Habit | Related documentation |
|-------|-------|-----------------------|
| 1 | State the three elements | [Your first task](/en/first-task) |
| 2 | Work in increments and refine across turns | [Sessions](/en/guide/sessions) |
| 3 | Experts, examples, and multiple tasks | [Experts](/en/guide/experts) · [Files](/en/guide/files) |
| 4 | Back up, then tighten permissions | [Approvals](/en/guide/approvals) · [Security](/en/security) |
| 5 | Automation | [Automation](/en/guide/automation) |
| 6 | Skills, browser, and related capabilities | [Skills](/en/guide/skills) |

---

## Related documentation

- [Scenario usage guide](/en/scenarios/usage-guide), for the general workflow
- [Practice examples](/en/scenarios/practice/)
- [Quickstart](/en/quickstart) · [Sessions](/en/guide/sessions) · [Skills](/en/guide/skills) · [Experts](/en/guide/experts) · [Settings](/en/guide/settings)
