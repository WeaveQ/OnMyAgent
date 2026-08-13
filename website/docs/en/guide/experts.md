---
title: Experts
---

# Experts

An expert is a configuration with a **role, methodology, skills, and memory**. It is not generic chat: it is a way to “bring in another colleague” for a particular role or scenario.

This guide follows the actual interface: **install an expert from Market → use it from Experts on the main rail → create your own expert**.

## 1. What is an expert?

| Dimension | Description |
|-----------|-------------|
| **Role** | Positioning such as startup coach or finance assistant, which shapes how the expert approaches a problem |
| **Role prompt** | The runtime core: expert overview, capabilities, rules, prohibited behavior, workflow, deliverable structure, and communication style in seven sections |
| **Skills** | Skills attached to the expert so it can perform specific actions |
| **Expert memory** | Stable background such as industry, project, and preferences—facts that do not change often |
| **Sessions** | Multi-turn collaboration with an expert from **Experts** on the main rail; its deliverables can appear under the expert source in [Files](/en/guide/files) |

How this differs from a [Skill](/en/guide/skills): a Skill is a capability pack, while an expert is a **role with preferences and a workflow that calls capabilities**.

---

## 2. Discover and select experts in Market

Entry: **Market** on the main rail → **Experts** in the top bar, next to Skills and Connectors.


### Key interface areas

| Area | Purpose |
|------|---------|
| **Experts / Skills / Connectors** in the top bar | Switch capability type |
| Category chips such as All, OPC Solo Company, Product R&D, and Finance investment | Filter by industry or scenario |
| Search | Search by role title or description |
| **Experts I created** | Browse experts you have created |
| **+ Create expert** | Start the creation flow described below |
| Expert card | Shows a name, summary, and tags; select it for details or use |

### Recommended workflow

1. Start from the category for the role, or search for terms such as finance, minutes, or legal.
2. Read each card's summary and choose an expert that matches the real work.
3. After installing or selecting it, open a session from **Experts** on the main rail instead of stopping after browsing Market.

---

## 3. Use an expert from the main rail

Entry: **Experts** on the left main rail.


### When the list is empty

If no expert conversation exists yet, the interface shows:

- **Search agents…** and **+ Create expert** at the top
- **No expert conversations yet**
- **Choose expert**, which starts with an existing or Market expert

### When an expert conversation exists


The typical structure is:

| Area | Purpose |
|------|---------|
| Left list | Experts you have added, such as Startup Coach |
| **+ Create expert** | Create a custom expert |
| **+ New session** | Start another conversation with the same expert |
| Introduction / Resources | Review the expert description and supporting material |
| Main conversation | Collaborate across turns, reference files with `@`, and invoke skills with `/` |
| Composer | Switch permission mode and model, as in a Home session |

### Recommended steps

1. Select **Experts** on the main rail.
2. If the list is empty, choose **Choose expert**, or install one from Market first.
3. Select the expert, then choose **New session** or continue an existing one.
4. Describe a **domain goal**, for example:

```text
You are a startup coach. Based on the business context below, propose the three
highest-priority validation experiments for this week. For each experiment,
include the hypothesis, minimum action, and success metric.
Write the result to notes/startup-weekly.md.
```

5. When source material is needed, [import it into Files](/en/guide/files) and reference it with `@`.
6. Accept the deliverable from **Files**, where expert output can be filtered by source when attribution is available.

### Prompting tips

| More effective | Avoid |
|----------------|-------|
| Name the role and the deliverable path | Saying only “help me think” |
| Set constraints such as audience, length, and format | Combining ten unrelated goals in one prompt |
| Work in stages: outline first, draft second | Asking for everything at once, then changing direction |

---

## 4. Create your own expert

You can enter from either location:

- **Experts** on the main rail → **+ Create expert**
- **+ Create expert** in the Market top bar


### Creation interface: Expert creation coach

The creation page is titled **Expert creation coach**. The coach is not the business expert itself. It will:

1. Introduce itself and ask, “What would you like this expert to help you with?”
2. Offer choices, while still allowing free text:
   - Analyze and make decisions
   - Handle specific tasks
   - Write content
   - Communicate and express ideas
3. Clarify the design in stages: positioning → capabilities → rules → prohibited behavior → workflow → deliverable structure → communication style.
4. When the proposal is complete, ask you to reply **“Confirm”** in the conversation before syncing the draft to the form on the right, including its name, description, role prompt, and expert memory.

The composer placeholder is **“Share your idea, and I’ll help create the expert”**.

### Configuration saved on the right after confirmation

| Field | Purpose |
|-------|---------|
| **Name / Description** | Displayed in lists and Market |
| **Role prompt** | The seven-section runtime role: Expert overview, Core capabilities, Key rules, Prohibited behavior, Workflow, Deliverable structure, and Communication style |
| **Expert memory** | Stable facts about the project, audience, or preferences; **do not** put the complete role prompt into memory |
| **Skills** | Skills this expert needs |
| **Knowledge**, when available | The scope of additional source material |

After the form is ready, you can select **Try it** to preview the behavior, then **Done** to save.

### Example creation conversation

```text
I want a “Weekly Meeting Minutes Expert” for product managers. It should turn
scattered meeting notes into decisions, action items with owner and date, and risks.
Always output Markdown in English, and never invent a decision that does not appear in the source.
```

After confirming the proposal, open a real session from the Experts list on the main rail.

---

## 5. Recommended first-time path

| Step | Action | Screenshot above |
|------|--------|------------------|
| 1 | Open Market → Experts and browse a card related to your role | Market section |
| 2 | Open Experts → Choose expert or start a new session | Use an expert section |
| 3 | Run one prompt that includes an output path | Prompt example |
| 4 | Optionally create an expert and use the coach to customize the role | Create your own expert section |

---

## 6. Expert vs Skill vs Home session

| | Expert | Skill | Home session |
|--|--------|-------|--------------|
| Best for | A stable role or methodology | A capability invoked for a task | Temporary tasks and exploration |
| Entry | Market · Experts or the Experts main rail | Market · Skills and `/` | Home · New task |
| Output | Expert session plus attributable files | Executed by the current session | Task deliverables |

---

## 7. Lifecycle and security

- Only **Experts I created** (installed or custom) can be permanently deleted. Marketplace builtins and product builtins (such as the creation coach) stay blocked.
- Delete removes the real sessions bound to that expert and the local package material, but must not remove `draft:*` sessions from the creation flow.
- Matching uses expert identity. A composite package name such as `pkg:pkg` must not block delete.
- Personal experts are written to the local profile; organization experts normally come from a read-only Company catalog.
- Expert memory, knowledge directories, and skills remain subject to workspace, file, and approval permissions.
- An expert resource being present in the app package does not mean it is installed in the current profile. Use the actual Experts I created list and real sessions as the source of truth.

## 8. Related documentation

- [Skills](/en/guide/skills) · [Sessions](/en/guide/sessions) · [Files and deliverables](/en/guide/files)
- [Your first task](/en/first-task) · [Interface and workspace](/en/guide/overview) · [Scenario: team pilot](/en/scenarios/team-pilot)
