---
title: "Scenario: Team Pilot"
---

# Scenario: Team Pilot

Use two to four weeks to determine whether OnMyAgent has entered **real office workflows**, instead of merely being installed and unused.

## 1. Goals

- Choose a pilot combination and define success criteria
- Have every participant complete installation → model setup → first deliverable
- Establish at least one frequent workflow per role, using an Expert or Skill and a fixed output path
- Optionally add messaging or company controls only after the local workflow works

## 2. Choose a combination first

See [Pilot combinations A/B/C](/en/platform/pilot-combos):

| Combination | Includes | Best for |
|-------------|----------|----------|
| **A (recommended start)** | OnMyAgent only | Prove local deliverables first |
| **B** | OnMyAgent + OnMyBuddy | Group-chat reminders + work performed locally |
| **C** | OnMyAgent + OnMyCompany, optionally OnMyBuddy | Organization policy and audit requirements |

**Start with A.** Add B or C only after two to four weeks of stable deliverables.

## 3. Suggested four-week cadence

| Week | Action | Definition of done |
|------|--------|--------------------|
| **0 · Prepare** | Choose the combination, select three to five seed users, and write success criteria | A written standard such as “at least two saved deliverables per person per week” |
| **1 · Install** | Everyone follows [Quickstart](/en/quickstart); agree on workspace conventions, either personal folders or project space | Everyone completes [Your first task](/en/first-task) |
| **2 · Role workflows** | Install one role-specific [Expert](/en/guide/experts) or [Skill](/en/guide/skills) from Market; fix the output path | One reusable prompt for each role |
| **3 · Deepen, optional** | Add an [Automation](/en/guide/automation) weekly report, or connect [Company](/en/platform/onmycompany) / OnMyBuddy | At least one Automation task or one organization-connection rehearsal |
| **4 · Review** | Measure adoption, blockers, and whether to expand | Stop / continue / expand decision |


## 4. Example success criteria

- **Adoption:** at least 70% of seed users still save deliverables by the end of week two
- **Quality:** colleagues can directly edit the deliverable; it is not only a chat response
- **Risk:** no complaints about unapproved dangerous local actions, and no credentials pasted into chat
- **Support:** blockers are listed by category: model, permission, path, or Skill source

## 5. Example workflows by role

| Role | Workflow | Entry point | Example output |
|------|----------|-------------|----------------|
| Project manager | Weekly meeting minutes | [Reports and meeting minutes](/en/scenarios/office-docs) | `notes/meeting-summary.md` |
| Operations | Workday morning brief | [Scheduled digests](/en/scenarios/automation-digest) | `notes/daily/….md` |
| Finance / legal | Review material with a domain Expert | [Experts](/en/guide/experts) + `@` file | `notes/review/….md` |
| Everyone | Personal preferences and Memory | [Settings · Personal / Memory](/en/guide/memory) | Less repeated context in each request |

## 6. Week-one installation-day checklist

- [ ] Install the correct platform package from [Download](/en/download)
- [ ] After launch, **+ New task** is available
- [ ] At least one provider is usable under [Settings → Models](/en/guide/models)
- [ ] Write `notes/hello.md` and open it from [Files](/en/guide/files)
- [ ] Know that [Approvals](/en/guide/approvals) and permission modes appear at the bottom of the composer

## 7. Retrospective agenda

1. Each participant presents one real deliverable path
2. List the top blockers: model / permission / prompting / unable to find a file
3. Decide whether to expand A, introduce B/C, or pause
4. Move reusable prompts into shared documentation or an Expert configuration

## Related

- [The three-product platform](/en/platform/) · [Pilot combinations](/en/platform/pilot-combos)
- [Quickstart](/en/quickstart) · [Experts](/en/guide/experts) · [Automation](/en/guide/automation)
- [Security and data](/en/security)
