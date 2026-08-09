---
title: Memory and Personal
---

# Memory and Personal

Cross-session **personal preferences, persona, and factual memory** live in the **Personal** group under [Settings](/en/guide/settings).

## 1. Personal

Tell the assistant who you are, how to address you, and how it should communicate by default.


| Section | Purpose |
|---------|---------|
| **Personal Info** | Your name and the assistant's name |
| **Personality** | Tone, such as practical and efficient, plus custom instructions that are always injected as collaboration rules |
| **About You** | Optional information such as MBTI and professional roles, to match your work context |

Custom instructions are suitable for stable rules such as: respond in English by default, lead with the conclusion, or give a conclusion before details when discussing code.

## 2. Memory

Manage factual memory extracted from conversations or maintained manually, along with local memory files.


| Capability | Description |
|------------|-------------|
| **Enable work memory** | Saved long-term and short-term memory is injected into later main sessions |
| **Auto-write from chat** | Matching points from conversation are written to memory automatically; can be disabled |
| **Local memory files** | Collaboration style, work handbook, user profile, and long-term memory stored only on this machine and editable in the folder |

Follow the paths currently shown in the UI and use **Open containing folder**. Runtime session/cache/log files belong in app data or a dedicated runtime root, not in a project repository. Keep work-memory text separate from task artifacts as well.

## 3. How it differs from session context and Archive

| | Purpose | Automatically crosses tasks? |
|--|---------|------------------------------|
| Current session context | Messages, tool results, and attachments in the current task | No; bounded by the context window |
| Personal / work memory | User preferences, stable facts, and collaboration rules | Yes; can be injected into later main sessions when enabled |
| Session Archive | History, search, analysis, and imports from known sources | Saves history, but is not automatically injected into every prompt |
| Personal Agent native memory | Mechanisms maintained independently by Codex, Claude, Hermes, and others | Determined by that Agent; OnMyAgent must not present it as one unified store |

## 4. Auto-write and review

Even with Auto-write from chat enabled, regularly review facts that are incorrect, outdated, or unsuitable for long-term storage. Do not rely on automatic extraction to decide whether passwords, Tokens, verification codes, medical/financial information, or customer secrets should be saved.

## 5. Principles

- Memory and persona text stay **on this machine** for audit and backup.
- Unlike one-session context, these settings can affect later tasks.
- Dangerous reset actions require confirmation.
- Organization policy and personal memory cannot override system security boundaries or organization denies.
- Before a backup, inspect files for private data. Use a fictional demo profile in public videos.

## 6. Related

- [Settings](/en/guide/settings) · [Sessions](/en/guide/sessions) · [Archive, search, and import](/en/guide/archive)
- [Security and data](/en/security)
