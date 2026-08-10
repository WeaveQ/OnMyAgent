---
title: Messaging channels
---

# Messaging channels

Messaging channels pass real messages from WeChat, Feishu/Lark, Telegram, or Discord to OnMyAgent, then return the Agent's result to the original conversation. They are useful for assigning work remotely, but a “connected” status alone does not mean the complete workflow is usable.

Product entry: **Channels** at the bottom of the left rail.

## 1. How channels differ from connectors and Agent chat

| Capability | Messaging channels | MCP / managed connectors | Agent chat |
|------------|--------------------|--------------------------|------------|
| Initiated by | An external IM user | The Agent in the current session | The OnMyAgent desktop user |
| Primary purpose | Receive a message and send the reply back to the IM platform | Call external tools, cloud documents, or services | Drive a local CLI / ACP Agent directly |
| External account required | Yes | Depends on the connector | Usually only requires the local Agent to be installed and signed in |
| Acceptance standard | Platform inbound → Agent execution → platform outbound | The tool call returns a real result | A real Agent result appears in the desktop app |

Capabilities with similar names do not necessarily use the same path. For example, the Feishu messaging channel sends and receives chat messages, while Lark CLI or a Feishu connector accesses documents or open-platform tools.

## 2. Available channels

| Channel | Connection method | Typical prerequisites | Guide |
|---------|-------------------|-----------------------|-------|
| WeChat | QR-code sign-in or saved account | A test WeChat account that can scan the code, network access, and allowed users | [WeChat](/en/guide/channels-weixin) |
| Feishu/Lark | WebSocket long connection or webhook | A Feishu app, event permissions, and bot visibility scope | [Feishu/Lark](/en/guide/channels-feishu) |
| Telegram | Bot API long polling | A Bot Token, access to the Telegram API, and a test user or group | [Telegram](/en/guide/channels-telegram) |
| Discord | Discord Gateway | A Bot Token, Gateway intents, and server/channel permissions | [Discord](/en/guide/channels-discord) |

The chat-channel registry also contains these placeholder shells; they are not usable channels:

| Names | Current status | What they can do |
|-------|----------------|------------------|
| Lark / WeCom / DingTalk | **Stub (transport not implemented)** | A plugin card or settings shell may appear, but it cannot send or receive real messages and cannot be used for E2E acceptance |

The same names may also appear as managed tools or connectors, which use a separate tool-call path. Do not confuse those connectors, the formal Feishu channel, and these Stub chat-channel shells.

## 3. General setup workflow

1. Open **Channels** and select a platform.
2. Save the account or application credentials required by that platform. Secret fields are for local configuration only; never include them in screenshots, logs, or public documentation.
3. Select a workspace, Agent, approval mode, and allowed directories.
4. Configure allowed users or complete pairing. Unknown users should not receive Agent execution access automatically.
5. Start the channel service and observe the connection status and processed/sent counters.
6. Send a message containing a unique identifier from a real platform account, then wait for the Agent reply in the original conversation.

## 4. Pairing, authorization, and approvals

- A first-time sender may enter the pending pairing list. Approve or reject the sender locally in OnMyAgent.
- Use a dedicated test account in the allowed-user list; do not grant an entire public group access.
- The approval mode determines whether the Agent asks, restricts, or proceeds when it encounters file writes, commands, or other actions.
- Platform messages can use status, cancel, new-session, and approval control commands. Follow the command descriptions currently shown on the channel page.

Common control semantics include `#status`, `#cancel`, `#new`, `#approve`, and approval rejection. If a new message arrives while a task is running, the system may ask the sender to check status or cancel the previous run first.

## 5. What counts as a real E2E success

A valid acceptance run must show all of the following:

1. The real message sent on the platform, including its time;
2. OnMyAgent receiving the matching sender/chat and unique test identifier;
3. The selected Agent actually executing and producing a completion or approval event;
4. OnMyAgent calling the platform's real send API;
5. The reply appearing in the same platform conversation.

None of these alone is sufficient: a green service indicator, a WebSocket in the `open` state, simulated local inbound traffic, a test POST to a local webhook, a mocked send function returning success, or a message visible only in OnMyAgent's local history.

## 6. Troubleshooting

| Symptom | Check first |
|---------|-------------|
| Connected, but no messages arrive | Event subscription, bot visibility, allowed users, and group mention rules |
| Message arrives, but there is no reply | Agent sign-in/model, pending approvals, workspace, and directory permissions |
| Processing succeeds, but the platform receives nothing | Send permission, target chat, and whether the bot is still in the group/channel |
| Duplicate replies or permanently busy | Current active run, reconnect/retry logs, and duplicate event delivery |
| Direct messages work, but groups do not | Group permissions, Gateway intents, mentions, or privacy mode |

## 7. Security recommendations

- Use a dedicated test bot, test group, and least privilege.
- Do not expose Tokens, App Secrets, QR codes, email addresses, user IDs, group IDs, or real chat content in public videos.
- Start with a read-only task, then gradually grant file-write or command permissions.
- Do not enable full access or automatic approval for unattended outbound workflows.

## 8. Related

- [Approvals and permissions](/en/guide/approvals) · [Agent chat](/en/guide/agent-chat) · [MCP and connectors](/en/guide/mcp)
- [Security and data](/en/security) · [Automation](/en/guide/automation)
