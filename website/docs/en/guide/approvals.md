---
title: Approvals and permissions
---

# Approvals and permissions

A local Agent may read or write files, execute commands, or operate a browser/desktop application. Use the conversation's **permission mode** and in-run **approval prompts** to control risk.

## 1. Where to change permissions

In the **bottom toolbar** of a session/task composer:

| Control | Purpose |
|---------|---------|
| **Permissions** (for example, Default permissions) | Controls automatic execution and whether sensitive steps require confirmation |
| **Model** | Selects the current session model, independently of permissions |
| `+` / attachments | Adds context, which remains subject to the permission mode |


A stricter mode interrupts you at sensitive steps instead of executing silently. Follow the labels in the composer's current dropdown.

## 2. Three permission layers

| Layer | What it controls | Example |
|-------|------------------|---------|
| Session access mode | Whether the current Agent may read, write, execute, or ask before sensitive actions | Default permissions, read-only, or ask-style modes |
| Agent-native approval | A specific request emitted by an underlying Agent such as Codex or Claude | Allow once, Allow for session, or Decline |
| Operating-system/service permission | Whether the app can access disk, screen, Accessibility, cloud accounts, or organization resources | macOS TCC, OAuth scopes, and company policy |

Relaxing one layer does not automatically relax the other two.

## 3. System-level permissions

Some features rely on operating-system authorization, including disk, Screen Recording, Accessibility, and microphone access. Review and grant them under [Settings → System](/en/guide/settings#system). These permissions control whether the system lets the app access a resource; they are distinct from the conversation permission mode.

## 4. When OnMyAgent interrupts you

Common actions that can require confirmation include:

- deleting or overwriting important files;
- executing a system command;
- accessing an unauthorized path;
- other local or outbound actions marked high-risk by the product.

Outbound messages, cloud-document writes, Git push, publishing, purchases, data clearing, and permanent deletion should also require explicit confirmation, even if a specific tool does not show an automatic prompt.

Confirmation prompts appear as soon as the session asks; you do not wait for the turn to finish. When interrupted, verify the exact command or tool, absolute path, target account/chat, impact scope, and reversibility. Then choose a one-time allowance, a current-scope allowance, or rejection. Do not make an unknown action permanently allowed just to suppress repeated prompts.

## 5. Auto approval and unattended work

Auto approval is suitable only for isolated workspaces, test accounts, and repeatedly verified low-risk workflows. An unattended automation or messaging channel is not a reason to bypass approval.

Recommended progression: run manually → inspect every approval → fix the input and output scope → restrict accounts and directories → then consider read-only automation or a narrower auto-approval rule.

## 6. Organization policy

When connected to [OnMyCompany](/en/platform/onmycompany) through Settings → **Company**:

- the desktop app must follow organization policy and **must not relax it locally**;
- some outbound actions may have to pass through the company Gateway.

Without a company connection, only local approvals and permission modes apply. Never paste a secret into chat; see [Security and data](/en/security).

## 7. Recommendations

| Scenario | Recommendation |
|----------|----------------|
| Exploration or drafts | A less restrictive mode can be appropriate, but still specify the output path |
| Editing production-related files | Tighten permissions and confirm each stage |
| Scheduled automation | Run it manually first; avoid prompts that allow unscoped deletion |
| Messaging channels | Allow only test users; retain approval for outbound messaging and file writes |
| Computer Use | Validate controls in a test application; do not operate payments or production administration |
| Remote runtime / sandbox | Verify token scope and the final sandbox backend; do not treat `auto` as proof of isolation |

## 8. Related

- [Security and data](/en/security) · [Settings](/en/guide/settings) · [Sessions](/en/guide/sessions) · [Automation](/en/guide/automation)
- [Messaging channels](/en/guide/channels) · [Browser and Computer Use](/en/guide/browser-computer-use)
