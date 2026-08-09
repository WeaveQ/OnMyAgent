---
title: Telegram messaging channel
---

# Telegram messaging channel

The Telegram channel uses the local Electron process to receive messages through Bot API long polling, then sends the Agent's reply to the original direct message or group.

Product entry: **Channels → Telegram**.

## 1. Prepare a bot

1. Create a test bot with the official BotFather in Telegram.
2. Save the Bot Token. Do not put it in chat history, screenshots, or the source repository.
3. If you need group chat, add the bot to a test group and adjust privacy mode and group permissions for the intended use.
4. Confirm that the current network can reach the Telegram Bot API.

## 2. Configure and start

1. Enter the account identifier and Bot Token on the Telegram channel page.
2. If the page provides an allowed-user list, add only the test account first.
3. Select a workspace, Agent, approval mode, and allowed directories.
4. Save and start the service. Processed/sent counters help with troubleshooting, but are not an E2E conclusion.

## 3. Direct messages, groups, and authorization

- Direct messages are the best place for the first test because the target identity is unambiguous.
- Group behavior can be affected by the bot's privacy mode. Mention the bot or send a command when required.
- An unknown sender should be stopped by pairing or the allowed-user list.
- Never grant full access or automatic approval to a public group.

## 4. Accept the real closed loop

Send a unique message from a real Telegram test account. Confirm real Bot API inbound traffic, correct Agent selection in OnMyAgent, real execution completion, successful Bot API outbound traffic, and the reply appearing in the same chat.

A local simulator call, fabricated Update, old-chat-history read, or healthy polling status cannot replace this closed loop.

## 5. Troubleshooting

| Symptom | Check |
|---------|-------|
| Start fails | Token validity and whether the network/proxy can reach the Bot API |
| Direct messages work, but groups do not | Privacy mode, bot group permissions, mentions, and allowed users |
| Updates are processed more than once | Whether another instance is polling Updates with the same Token |
| Task is stuck | Agent sign-in/model, approvals, and active-run status |

## 6. Related

- [Messaging channels overview](/en/guide/channels) · [Agent chat](/en/guide/agent-chat) · [Security and data](/en/security)
