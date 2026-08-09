---
title: Feishu/Lark messaging channel
---

# Feishu/Lark messaging channel

The Feishu channel lets a custom enterprise application pass messages to OnMyAgent through a WebSocket long connection or webhook, then uses the bot to reply in the original chat. In international Lark deployments, use the corresponding Lark open-platform settings.

Product entry: **Channels → Feishu**.

## 1. Choose a connection method

| Method | Best for | Additional requirement |
|--------|----------|------------------------|
| WebSocket long connection | A local machine without a public callback URL | Enable long-connection event delivery for the Feishu app, and allow network access to the open platform |
| Webhook callback | An existing stable public endpoint or controlled tunnel | Feishu must be able to reach the configured URL; a local listener address is normally not public |

A WebSocket in the `open` state only proves that the transport connection exists. It does not prove event permission, message delivery, or bot replies.

## 2. Prepare the Feishu application

1. Create a custom enterprise application in the Feishu Open Platform and enable its bot.
2. Grant the permissions required to receive message events and send bot messages.
3. Publish the application to a test scope, then add the bot to a test direct message or group.
4. Prepare the App ID and App Secret. Webhook mode may also use a Verification Token and Encrypt Key.

Permission and event names may change as the Feishu platform evolves; follow the current open-platform console. Grant the smallest test scope instead of authorizing an entire production organization.

## 3. Configure OnMyAgent

1. Enter the App ID and App Secret.
2. Select **WebSocket long connection** or **Webhook callback**.
3. In Webhook mode, verify the host, port, and path, then configure the genuinely public URL in Feishu. A `127.0.0.1` address shown on the page is reachable only from the local machine.
4. Select a workspace, Agent, approval mode, and allowed users.
5. Save and start the service.

## 4. Group chats and pairing

- A group may require mentioning the bot. Whether a mention is mandatory depends on the application event configuration and current channel policy.
- A first-time sender may require local pairing approval in OnMyAgent.
- The application visibility scope, group membership, and allowed-user rules must all pass.
- Receiving an event does not prove that the message reached the correct Agent. Also verify the bound workspace and Agent.

## 5. Accept the real closed loop

Send a message containing a unique identifier from a Feishu test chat. Confirm that OnMyAgent receives a real `im.message.receive_v1`-type event, the Agent completes the task, the real Feishu send API is called, and the bot reply appears in the same chat.

None of the following is sufficient by itself: WebSocket `open`, a message in local history, an incremented processing counter, a manual POST to a local webhook, a fake WebSocket, or a fake OpenAPI send.

## 6. Troubleshooting

| Symptom | Check |
|---------|-------|
| Long connection is open, but no inbound message | Event-delivery method, application publication state, visibility scope, and message-event permission |
| Direct messages work, but groups do not | Whether the bot joined the group, mention requirements, and group-event permission |
| Inbound works, but execution does not start | Pairing/allowed users, Agent and model, and approval queue |
| Execution completes, but no reply arrives | Send-message permission, target chat, and published application version |
| Webhook verification fails | Public reachability, Verification Token, Encrypt Key, and callback path |

## 7. Related

- [Messaging channels overview](/en/guide/channels) · [Company connection](/en/guide/company) · [Approvals and permissions](/en/guide/approvals)
