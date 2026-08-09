---
title: Discord messaging channel
---

# Discord messaging channel

The Discord channel connects a bot to Discord Gateway, receives messages from direct messages, server channels, or threads, and returns the Agent's result to the original location.

Product entry: **Channels → Discord**.

## 1. Prepare a bot

1. Create a test Application and Bot in the Discord Developer Portal.
2. Enable the Gateway intents required for your use, especially the intent needed to read message content.
3. Invite the bot to a test server and test channel with the minimum permissions.
4. Save the Bot Token. Rotate it immediately if it appears in any public image.

## 2. Configure and start

1. Enter the account identifier and Bot Token on the Discord channel page.
2. Configure allowed users, then select a workspace, Agent, approval mode, and allowed directories.
3. Save and start the channel, then wait for the Gateway state to stabilize.
4. Do not skip a real channel test just because the Gateway is connected.

## 3. Direct messages, server channels, and threads

- Direct messages are useful for validating one-to-one authorization.
- In a server channel, the bot needs permission to view the channel, read message history, and send messages.
- For a thread, also confirm that the bot can see and reply in that thread.
- In a public channel, require an explicit mention or use a dedicated test channel so ordinary conversation does not trigger the Agent.

## 4. Accept the real closed loop

Send a unique message from a real Discord test account in the target channel. Confirm the Gateway inbound event, OnMyAgent dispatch, real Agent execution, Discord REST send, and the reply appearing in the target channel.

Gateway `ready`, a healthy heartbeat, a simulated event, or local send-function success is not a complete E2E result.

## 5. Troubleshooting

| Symptom | Check |
|---------|-------|
| Gateway connects, but no messages arrive | Message Content intent, channel visibility, and whether the bot is still in the server |
| Bot can read, but cannot reply | **Send Messages** / **Send Messages in Threads** permissions |
| Direct messages fail | Whether the user allows DMs from server members and the bot application's scope |
| More than one reply | Duplicate bot instances or event replay |
| Agent does not execute | Allowed users, workspace/Agent binding, model, and approval state |

## 6. Related

- [Messaging channels overview](/en/guide/channels) · [Approvals and permissions](/en/guide/approvals) · [Security and data](/en/security)
