---
title: FAQ
---

# Frequently Asked Questions

### What is OnMyAgent?

A local-first desktop Agent workspace for assigning work, executing it, and delivering files—not only chatting.

### Must I sign in or use the cloud?

**No.** Local use is available by default. Connecting [OnMyCompany](/en/platform/onmycompany) is optional.

### How does it relate to Feishu/Lark or DingTalk bots?

IM-based digital employees belong to **OnMyBuddy**. The desktop workspace is **OnMyAgent**. See [The three-product platform](/en/platform/).

### Which models are supported?

OnMyAgent uses BYOK and supports compatible APIs and local models such as Ollama. Connect a provider under [Settings → Models](/en/guide/models). After you save, Home sessions can use the model, in the same order as Settings.

### Settings model list spins on first open?

Current preview builds ship a catalog snapshot, so the list should appear quickly. If it still hangs, check the network and restart. See [Models troubleshooting](/en/guide/models#models-troubleshooting).

### Sending a spreadsheet or PDF to an Expert fails?

Attach it in the chat. Split a long text message, or send a smaller file. See [Experts](/en/guide/experts).

### Where is Settings?

Select the gear icon in the lower-left corner → **Settings**, or press **⌘ ,** / **Ctrl ,**. See [Settings](/en/guide/settings) for every section.

### Can I use it on Windows?

A developer-preview path is available; macOS remains the primary supported platform. See [Windows](/en/install/windows).

### Could it damage my files?

Operations are scoped to the workspace by default, and imports are workspace copies. Keep your own versioned backups of important files. See [Files](/en/guide/files) and [Security](/en/security).

### What is the difference between an Expert and a Skill?

An **Expert** focuses on a role and working method; a **Skill** is an executable capability package. Both can be installed from Market. See [Experts](/en/guide/experts) and [Skills](/en/guide/skills).

### How do I configure personal preferences and Memory?

Open Settings → **Profile** (Personal group). See [Memory and Profile](/en/guide/memory).

### How do I download OnMyAgent?

See [Download and installation](/en/download).

### How do I update OnMyAgent?

Open Settings → **Updates** → **Check for updates** (a cold start also checks once). If you are already on the latest build, the app says so. When a new version is found, **click the notice or Download update** to start the download. In a packaged build, click **Restart and install** when it finishes. In a development build, install from [GitHub Releases](https://github.com/WeaveQ/OnMyAgent/releases) instead. If macOS says the app is damaged, run `xattr -cr /Applications/OnMyAgent.app` and open it again.
