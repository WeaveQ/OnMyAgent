---
title: Security and Data
---

# Security and Data

## 1. Where data is stored

| Data type | Default location |
|-----------|------------------|
| Workspace files and deliverables | A local folder you choose |
| Local configuration | The OnMyAgent configuration directory on this computer |
| Local mirror of organization configuration after connecting a company | A local profile; the enterprise server remains the source of truth for policy |

## 2. Credentials (BYOK)

- You or your organization configure the API key; using OnMyAgent does not require handing credentials to a public cloud by default
- Do not paste long-lived credentials into a conversation
- Configure provider credentials under [Settings → Models](/en/guide/models); configure general environment variables under [Settings → System](/en/guide/settings#system). Local environment settings are integrated into the System section and no longer have a separate navigation row

## 3. When no company is connected

- With no enterprise address or enterprise session, OnMyAgent **does not make enterprise HTTP requests**
- Local capabilities remain fully available

## 4. Approvals

Risky local actions can require confirmation. See [Approvals and permissions](/en/guide/approvals).

## 5. Reset and data removal

[Settings → Reset](/en/guide/settings#reset) can clear preferences or application data. **Reset application data** does not remove the configuration owned by CLIs such as Claude, Codex, or OpenCode.

## 6. Open-source audit

<https://github.com/WeaveQ/OnMyAgent>
