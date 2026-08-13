---
title: Settings
---

# Settings

The complete Settings page manages models, company connection, personal profile, appearance preferences, system/runtime environment, updates, and data. A group navigation appears on the left; the selected section appears on the right.

## 1. Open Settings

Use either method:

1. Select the bottom-left **gear**, then **Settings** in the menu.
2. Press **⌘ ,** on macOS or **Ctrl ,** on Windows.


The menu also contains shortcuts for appearance, Agent management, update checks, and Quit. Open the **Settings** page for the full configuration.

## 2. Settings overview

Settings opens on **Overview**, where cards group every section under Workspace, Personal, Global, and Data.


| Group | Section | Purpose |
|-------|---------|---------|
| Top | **Overview** | Preview and entry for all settings |
| Workspace | **Models** | Connect and manage AI model providers |
| Workspace | **Company** | Connect OnMyCompany and synchronize organization skills and experts |
| Personal | **Personal** | Names, tone, custom instructions, and work profile |
| Personal | **Memory** | Facts extracted from conversations and local memory files |
| Global | **Preferences** | Language, theme, font, conversation width, session compaction, and other app-wide choices |
| Global | **System** | Launch at login, notifications, system permissions, plus the local runtime environment and environment variables |
| Global | **Keyboard shortcuts** | Customize general, task, and session shortcuts |
| Global | **Updates** | Version, check for updates; packaged builds download in the background then restart to install |
| Data | **Reset** | Reset onboarding or clear local app data |
| Data | **Archive** | Restore or delete archived tasks |

Important distinctions:

- **Preferences** is Global, not Workspace; language and theme affect the whole app.
- Legacy paths such as `/settings/environment` and `/settings/permissions` still open **System**. Environment no longer occupies a separate navigation row.
- **Usage** remains available only as a compatibility deep link. It is absent from ordinary navigation and Overview, so do not treat it as a public Settings section.

Select **Back to app** in the left navigation to leave Settings.

## 3. Workspace

### Models

Connect and manage AI model providers, including BYOK, local models, and custom endpoints.


- Inspect connected providers and the number of available models.
- Use **Connect model provider** or **Custom model provider configuration**.
- Edit an added provider, or use **Remove** to disconnect / delete it.

See [Models and BYOK](/en/guide/models).

### Company

Connect [OnMyCompany](/en/guide/company) to synchronize organization skills, experts, models, the Gateway catalog, and a policy mirror.


Enter the service URL and sign in with a company email plus verification code. Use the health check to verify that the service is reachable.

## 4. Personal

### Personal

Tell the assistant who you are, how it should address you, and how it should communicate by default.


- **Personal Info**: your name and the assistant's name.
- **Personality**: tone and custom instructions that remain active as collaboration rules.
- **About You**: optional MBTI, professional roles, and other work-context information.

### Memory

Manage facts extracted from conversations or added manually, plus local memory files.


- **Enable work memory** / **Auto-write from chat** control whether conversation points enter long-term memory.
- **Local memory files** include collaboration style, work handbook, user profile, and long-term memory, and can be edited directly in their folder.

See [Memory and Personal](/en/guide/memory).

## 5. Global

### Preferences

App-wide choices for language, theme, font, and panel layout. These settings do **not** belong to a workspace.


Common items include:

- **Interface**: language and theme—Light, Dark, or System.
- **Display**: font size, conversation width, whether model-reasoning traces are expanded, and system-tray icon.
- **Session management**: automatic context compaction and automatically starting a new session after a long idle period.

### System

Manage launch behavior, notifications, system-level permissions, and the local runtime environment.


- **App options**: Launch at login, keep the system awake, and desktop/task-completion/sound notifications.
- **System Authorizations**: Full Disk Access, Screen Recording, Accessibility, microphone, and other permissions used by Appshot, automation, and notifications.
- **Local environment**, formerly the separate Environment section: installation state for the OpenCode runtime, Node.js, and Python; local API-key environment variables. Values stay on this machine, and `ONMYAGENT_` / `OPENCODE_` are reserved prefixes.
- **Computer Use**: helper/driver, runtime status, and system authorization. See [Browser and Computer Use](/en/guide/browser-computer-use).

Applying local environment variables or runtime configuration may restart the affected Agents and interrupt active work. Save your work and avoid changing these settings during a critical run.


### Keyboard shortcuts

Customize shortcuts for general, task, and session actions.


Default examples, all customizable:

| Command | Default |
|---------|---------|
| Open settings | ⌘ , |
| Global quick chat | ⌘ B |
| Toggle sidebar | ⌘ \ |
| New task | ⌘ N |
| Search in current task | ⌘ F |
| Send message | ⌘ ↩ |
| Insert line break | Shift ↩ |
| Capture desktop | ⌘ Shift A |

The page supports search and **Restore all defaults**.

### Updates

Inspect the current version and check for updates.

The page shows the current version and **Check for updates**.

| Build | Behavior |
|-------|----------|
| **Packaged desktop** | Checks prereleases and stables. A new version **downloads in the background**; then click **Restart and install**. Nothing installs silently or on quit. |
| **Development build** | Can check or open the release page; it cannot complete the real download/install path. |

Current preview builds are not notarized. If macOS blocks the app after an in-app update, run:

```bash
xattr -cr /Applications/OnMyAgent.app
```

You can always install from [GitHub Releases](https://github.com/WeaveQ/OnMyAgent/releases).

## 6. Data

### Usage (hidden compatibility page)

Usage code and its deep link still exist, but the page is absent from ordinary Settings navigation and Overview. It has Hidden compatibility status and must not be demonstrated as a public Settings entry. See [Feature and platform status](/en/guide/capability-status).

### Reset

Reset onboarding or clear local app data. The app restarts after confirmation.


| Action | Description |
|--------|-------------|
| **Reset onboarding** | Clears local preferences and personal profile, then returns to onboarding; **workspaces are preserved** |
| **Reset app data** | Completely clears OnMyAgent data and preferences on this machine; it **does not** remove configuration owned by CLIs such as Claude, Codex, or OpenCode; requires typing a confirmation phrase |

### Archive

Filter, restore, or permanently delete archived tasks. For Session Archive sources, search, and import, see [Archive, search, and import](/en/guide/archive).


You can filter by project, search archived tasks, unarchive them, or delete them permanently.

## 7. Recommended configuration order

1. **Models**: connect the default provider and key.
2. **Preferences** under Global: language, theme, and font.
3. **Personal**: name and custom instructions.
4. **System**: notifications, required permissions, local runtime environment, and business API keys.
5. Optional: **Company** to connect an organization.

## 8. Related

- [Models and BYOK](/en/guide/models) · [Memory and Personal](/en/guide/memory) · [Security and data](/en/security) · [Interface overview](/en/guide/overview)
- [Company connection](/en/guide/company) · [Archive, search, and import](/en/guide/archive) · [Feature and platform status](/en/guide/capability-status)
