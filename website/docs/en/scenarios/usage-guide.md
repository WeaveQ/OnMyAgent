---
title: How to Use the Scenarios
---

# How to Use the Scenarios

This is the **general working method** for OnMyAgent: turn a chat into a verifiable deliverable on your computer. It is not tied to any industry or customer, and applies to reports, spreadsheets, content, automation, and more.

In one line: **state the goal → provide the source material → work in small steps → verify the files → automate what repeats.**


---

## 1. Set the right expectations

| OnMyAgent is good at | Do not assume it will |
|----------------------|-----------------------|
| Plan and **execute** multi-step work from your source material | Read your mind or deliver a perfect result in one pass when key information is missing |
| Read, write, and generate files you can open in a **workspace** | Silently change system folders or bypass confirmation for risky actions |
| Turn methods into reusable **Experts / Skills** | Pretend an uninstalled capability is available |
| Improve work over **multiple turns** and repeat it with **Automation** | Produce a final draft on the first attempt or make backups automatically in every case |

Local first: credentials and files stay on your computer by default. Connecting a company or messaging service is optional, not a prerequisite.

---

## 2. Recommended 30-minute onboarding path

| Step | What to do | Guide |
|------|------------|-------|
| 1 | Install the app, choose a workspace, and connect a model | [Quickstart](/en/quickstart) |
| 2 | Complete the “one request → file on disk” flow | [Your first task](/en/first-task) |
| 3 | Learn ten productive habits | [Tips for effective use](/en/guide/efficient-tips) |
| 4 | Install and discover Skills as needed | [Skills](/en/guide/skills) |
| 5 | Follow one end-to-end example | [Practice examples](/en/scenarios/practice/) |

---

## 3. A standard formula for assigning work

Whenever possible, include all three parts (see [Tip 1](/en/guide/efficient-tips)):

```text
[What] Goal + delivery format (table / md / pptx …)
[Inputs] @file or workspace path; if there is none, say “No source material—state and label assumptions.”
[How] Audience, length, language, exclusions, and output path (for example notes/xxx.md)
```

**Too vague:** Organize the last meeting for me.

**Better:**

```text
Turn @notes/raw-meeting.txt into meeting minutes with decisions, action items
(owner + date), and open questions. Put the action items in a table.
Write the result to notes/meeting-summary.md. Do not add an introduction.
```

If you are unsure, first ask: “I want to accomplish XX. What information do you need?” Then execute.

---

## 4. The universal execution loop

```text
1. Create a task (or start a new session under an Expert)
      ↓
2. Import source material → reference it with @ (or state the path)
      ↓
3. Take one small step and request a verifiable intermediate result
      ↓
4. Open it in Files → adjust the request and rerun if needed
      ↓
5. Save the final version separately; avoid overwriting originals
      ↓
6. If it repeats every week → give the same prompt to Automation
```

| Stage | Where in the app |
|-------|------------------|
| Assign work | Home → **+ New task** |
| Source material | Import through [Files](/en/guide/files), then use `@` in the composer |
| Capabilities | `/` Skills · [Market](/en/guide/skills) · [Experts](/en/guide/experts) |
| Verify | Main rail → **Files** |
| Repeat | Main rail → **Automation** |
| Control risk | Composer → **Permissions** · [Approvals](/en/guide/approvals) |

---

## 5. Choose an entry point by type of work

| You want to… | Best starting path | Practice / scenario |
|--------------|--------------------|---------------------|
| Organize, rename, or archive local files | Session + preview a before/after table first | [Practice 1 · Files](/en/scenarios/practice/files) |
| Draft a proposal, meeting minutes, or revised copy | Session + save an md/docx file | [Practice 2 · Documents](/en/scenarios/practice/docs) · [Reports and meeting minutes](/en/scenarios/office-docs) |
| Clean a spreadsheet, summarize it, and draw conclusions | `@` a spreadsheet + an Office Skill | [Practice 3 · Spreadsheets](/en/scenarios/practice/data) |
| Plan topics, scripts, and channel-specific copy | A session or content-focused Expert | [Practice 4 · Content](/en/scenarios/practice/content) |
| Produce a fixed daily or weekly brief | Prove it manually → automate it | [Practice 5 · Briefs](/en/scenarios/practice/daily-brief) |
| Work with content only visible after opening a webpage | A browser Skill | [Browser and Computer Use](/en/guide/browser-computer-use) |
| Standardize a job-specific method | Install or create an Expert | [Experts](/en/guide/experts) |
| Turn a process into a reusable capability | find-skills / skill-creator | [Practice 6 · Skills](/en/scenarios/practice/skills-evolve) |
| Keep work moving on a schedule | Automation + a self-contained prompt | [Practice 7 · Continuous execution](/en/scenarios/practice/self-drive) |
| Extract meeting actions | Text-based meeting-minutes workflow | [Practice 8 · Meetings](/en/scenarios/practice/meetings) |
| Work with cloud documents, if authorized | The matching document Skill | [Practice 9 · Cloud documents](/en/scenarios/practice/tencent-docs) |

---

## 6. Experts and Skills: when to use each

| | **Skill** | **Expert** |
|--|-----------|------------|
| What it is | An executable capability package (tools / workflow) | A role + method + optional collection of Skills |
| Best for | “Process this type of file / open a website / find a Skill” | “Complete a task using this job role’s full working method” |
| Entry point | Market → Skills · `/` | Market → Experts · main rail → Experts |

- Not sure what to use? Ask: “List the suitable Skills and explain the differences” (Find Skills).
- Need consistent industry language? Use an Expert, or set persistent instructions in [Personal / Memory](/en/guide/memory).
- For a capability overview, see [Skills](/en/guide/skills).

---

## 7. Quality and safety checklist

**Quality**

- [ ] The first pass is for direction, not perfection
- [ ] A large task has been split into two or three steps
- [ ] The deliverable opens in Files and uses the agreed path
- [ ] Missing source data is labeled “not present in the source,” not invented

**Safety**

- [ ] Important files are backed up, or the request explicitly says “save as a new file”
- [ ] You reviewed a preview before confirming bulk rename or deletion
- [ ] The permission mode matches the risk ([Approvals](/en/guide/approvals))
- [ ] Credentials are not pasted into chat; web research accounts for source quality and copyright

**Before automation**

- [ ] The same prompt succeeded manually at least once
- [ ] The prompt does not depend on “the conversation above”
- [ ] The output directory is fixed

---

## 8. Prompt templates

**General deliverable**

```text
Goal: …
Inputs: @… or workspace path …
Constraints: audience … length … language … do not …
Output: write to notes/….md (or an xlsx/pptx path)
If information is missing, list what is needed. Do not fabricate it.
```

**Preview before changing files**

```text
… (same details as above)
First show a before/after table or preview. Do not write to disk until I reply “Confirm and execute.”
```

**Advance one step at a time**

```text
In this turn, do only step 1: … and write the result to …
Do not start step 2 until I confirm.
```

---

## 9. How this differs from a chat-only AI

| Chat only | OnMyAgent used with this workflow |
|-----------|-----------------------------------|
| The result stays in the chat | The result lives in **workspace files** |
| Ask for a perfect answer in one pass | **Small steps + multiple turns + file verification** |
| No role or tools | Combine **Experts / Skills / browser / Office** capabilities |
| Re-enter repetitive work manually | Once proven, assign it to **Automation** |

---

## 10. Documentation map

| Type | Link |
|------|------|
| Ten productive habits | [Tips for effective use](/en/guide/efficient-tips) |
| Capability reference | [Skills](/en/guide/skills) |
| End-to-end examples | [Practice examples](/en/scenarios/practice/) |
| Interface and settings | [Interface overview](/en/guide/overview) · [Settings](/en/guide/settings) |
| Pilot rollout | [Team pilot](/en/scenarios/team-pilot), for organizational adoption |

---

## Related

- [Quickstart](/en/quickstart) · [Your first task](/en/first-task) · [Sessions](/en/guide/sessions) · [Security and data](/en/security)
