---
title: MCP and connections
---

# MCP and connectors

MCP, the Model Context Protocol, provides external tools and resources to an Agent through a standard protocol. OnMyAgent also supports managed CLIs, cloud-service plugins, and messaging channels; these are different layers.

## 1. Where to configure MCP

Primary entry: **Market → Connectors** on the left main rail. A workspace setting, Skill detail page, or first invocation can also expose a configuration entry.



## 2. MCP and other connection types

| Type | Primary purpose | Details |
|------|-----------------|---------|
| MCP | Standard tools and resources that can be enabled, disabled, and reloaded | This page |
| Managed connector | Install or sign in to a local CLI or cloud-service plugin | [Connectors and managed tools](/en/guide/connectors) |
| Messaging channel | Receive work from an external IM service and reply to the originating chat | [Messaging channels](/en/guide/channels) |
| BrowserSkill | Bridge to an external `bsk` process and browser extension | [Browser and Computer Use](/en/guide/browser-computer-use) |

## 3. Add and manage an MCP server

1. Open the Connectors catalog or the workspace MCP setting.
2. Select an existing item, or provide the command or address and required parameters for a custom MCP server.
3. Before saving, confirm the execution location, working directory, and source of environment variables.
4. After enabling it, wait for the runtime reload, then inspect the tool list in the current session.
5. Use a read-only call to verify both the returned content and the identity of the target service.

Adding, editing, enabling, disabling, and deleting an MCP configuration are configuration writes. They can require collaborator permission and approval, and can emit audit or reload events.

## 4. OAuth and credentials

- API keys, tokens, and secrets belong in password-type configuration or the system credential store, not in a conversation.
- After OAuth sign-in, still verify the granted scope and target account.
- **OAuth logout** disconnects that authorization only. Whether it deletes local CLI state, caches, or data in the third-party account depends on that service.
- A configuration change triggers a reload; an active session may need to be reopened or retried.

## 5. Invoke a connector from a session

On first use, verify the tool name, account, resource, and write target the Agent intends to use. Keep human approval for create, update, delete, publish, share, or send operations, then verify the real result in the external service.

A tool returning “success” does not prove that the business goal is complete. After creating a cloud document, for example, open the real document and check its content, permissions, and link.

## 6. Company mode

After [OnMyCompany](/en/guide/company) is connected, some external sends and model calls can travel through the organization Gateway. Organization policy is authoritative on the server. The desktop app can consume the allowlist, but cannot weaken a deny rule locally or retrieve Gateway credentials.

## 7. Troubleshooting

| Symptom | What to check |
|---------|---------------|
| Enabled, but no tool appears in the session | Whether reload completed, the current workspace, and whether the Agent supports MCP |
| Startup failure | Command or URL, working directory, environment variables, port, and network |
| OAuth succeeded, but access is denied | Scope, target organization or account, and resource sharing permissions |
| Tool call times out | Service health, proxy, expired authentication, and the Agent active run |
| A connector exists in the desktop app but the Agent cannot see it | It may be a managed plugin rather than MCP; check its connection type |

## 8. Security principles

| Principle | Meaning |
|-----------|---------|
| Least privilege | Expose only the tools, accounts, and resources the task requires |
| Keep keys out of chat | Save them in configuration; do not expose them in screenshots, logs, or Git |
| Approve writes | Require human confirmation for sends, deletes, publishing, and sharing |
| Make access revocable | Disable an unused connector and revoke its third-party authorization |
| Verify the real result | Confirm in the target service instead of trusting only the local return value |

## 9. Related documentation

- [Skills](/en/guide/skills) · [Connectors and managed tools](/en/guide/connectors) · [Messaging channels](/en/guide/channels)
- [Approvals and permissions](/en/guide/approvals) · [Security and data](/en/security)
