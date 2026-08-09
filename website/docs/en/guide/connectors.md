---
title: Connectors and managed tools
---

# Connectors and managed tools

Connectors let an Agent access external applications, cloud documents, or command-line tools on the local machine. In OnMyAgent, “connector” does not describe a single technology, and each type has different configuration and permission boundaries.

Product entry: **Market → Connectors**. Some tools also appear in Settings, a Skill, or a session capability menu.

## 1. Do not confuse the four extension types

| Type | Purpose | Common management location |
|------|---------|----------------------------|
| MCP | Expose tools and resources to an Agent through a standard protocol | Market, Settings, or session capabilities |
| Managed tool | Let OnMyAgent detect, download, or connect to a local CLI | Connector details |
| Cloud-service connector | Access cloud data through OAuth, a token, verification code, or service API | Connector details |
| Messaging channel | Receive a task from IM and reply to the originating chat | **Channels** on the main rail |

A Feishu/Lark connector can provide document or Open Platform tools. A Feishu messaging channel handles chat messages. Configuring one path does not prove that the other works; both must be connected and verified independently.

## 2. Common managed capabilities today

The product code contains connection entries for OfficeCLI, Lark CLI, Tencent Docs, Baidu Netdisk, Kingsoft Docs, DingTalk, WeCom, and Tencent Meeting. Actual availability depends on the platform, network, account, installed-tool state, and app version.

| Type | What it may require |
|------|---------------------|
| Local CLI | Download or locate an executable, verify its version, and establish sign-in state |
| OAuth | Complete browser authorization and callback with an allowed scope |
| Token or app credentials | Create an application in the platform console and store its credentials |
| Verification code or QR code | Complete one human confirmation on the platform side |
| Enterprise service | Ask an organization administrator to enable the application, document, or Gateway permission |

A plugin appearing in source code or Market does not prove that it is installed on this machine or that the current account can access real cloud data.

## 3. Install and connect

1. Open the connector details and read the platform, account, and permission requirements.
2. Detect the local tool. If a download is required, verify its source, version, and install path.
3. Complete OAuth, token, QR-code, or verification-code sign-in.
4. Run a connection test against a dedicated, non-sensitive resource.
5. Return to the session and confirm that the connector appears in the capability menu only when needed.

Installing a managed CLI changes local tool state. Disconnecting an account and uninstalling the tool are different actions; do not treat Disconnect as removal of every local file.

## 4. Use a connector in a session

- State both the goal and target platform, such as “read the documents in the test folder and create a summary.”
- On first use, inspect which connector, account, and resource the Agent intends to access.
- Keep approval enabled before writing, publishing, sharing, or sending externally.
- Bring deliverables back to the workspace or Files for independent acceptance; a successful tool-call message alone is insufficient.

## 5. Permissions and credentials

- Grant only the minimum scope required by the task.
- API keys, tokens, cookies, and verification codes must not appear in public videos, debug reports, or Git diffs.
- Real enterprise Gateway credentials must not return to the desktop process.
- Changing connector configuration can trigger a runtime reload; a task already in progress may need to be reopened or retried.

## 6. Common states

| Status | Meaning | Next step |
|--------|---------|-----------|
| Not installed | The required CLI or component is absent | Check platform support, then install it or choose another implementation |
| Installed, not signed in | The tool exists, but there is no usable session | Complete platform sign-in |
| Connected | Authentication check succeeded | Perform one real read-only resource test |
| Authorization required | OAuth, verification code, or QR-code flow is incomplete | Confirm manually on the platform side |
| Connection failed | Network, credential, scope, or version mismatch | Inspect a redacted error and the platform console |
| Disconnected | OnMyAgent no longer uses the current account | For complete cleanup, follow that tool's separate instructions |

## 7. Related documentation

- [MCP and connectors](/en/guide/mcp) · [Messaging channels](/en/guide/channels) · [Skills](/en/guide/skills)
- [Approvals and permissions](/en/guide/approvals) · [Security and data](/en/security)
