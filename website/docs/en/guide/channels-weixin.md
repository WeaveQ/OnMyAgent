---
title: WeChat messaging channel
---

# WeChat messaging channel

The WeChat channel connects a test WeChat account through QR-code sign-in or saved account information, so authorized users can assign work to OnMyAgent from WeChat and receive replies in the original conversation.

Product entry: **Channels → WeChat**.

## 1. Prerequisites

- A WeChat account approved for testing and a phone that can scan the QR code;
- The OnMyAgent desktop app kept running with access to the WeChat service;
- A working workspace, Agent, and model;
- A test conversation with no real business or private information.

## 2. Sign in and start

1. Open the WeChat channel and select **Scan QR code to sign in**.
2. Scan the QR code with WeChat on your phone and confirm on the phone.
3. Wait until the page shows that the account has been saved. If prompted, select **Check sign-in**.
4. Select a workspace, Agent, approval mode, and allowed directories.
5. Start the channel service.

If you use saved account information, enter it only in the product's password-style field. Never copy a Token into a chat, screenshot, or issue report.

## 3. Pair a test user

1. Send unique test text such as `OMA-E2E-date-sequence` from the test WeChat account to the connected account.
2. Return to OnMyAgent and open the pending-pairing list.
3. Verify the redacted identity and approve the user.
4. Send the test task again. The first unauthorized message must not be treated as a completed task.

## 4. Accept the real closed loop

Use a task that only asks for a fixed-format reply and does not read or write real files. Record the time WeChat sent the message, the OnMyAgent inbound event, the Agent completion event, the outbound send result, and the time WeChat received the reply.

A successful scan, successful polling, or healthy account status proves only the sign-in path. E2E succeeds only after the Agent reply appears in the real WeChat conversation.

## 5. Files and media

When sending or receiving files, OnMyAgent still enforces authorized roots, file-type, size, and security checks. An absolute path recorded by the runtime cannot bypass the allowed directories.

Start with a small test file that contains no private information. Do not use real contracts, customer data, or credential files as public-video material.

## 6. Troubleshooting

| Symptom | Action |
|---------|--------|
| QR code expired | Generate a new code and scan it; never reuse a QR code shown in a public video |
| Signed in, but no inbound messages | Check that the channel service is running, allowed users, and network access |
| Permanently busy | Use the status command to inspect the active run; cancel it safely before retrying if necessary |
| Reply exists locally, but not in WeChat | Check the real send result, target user, and whether the account is still online |
| Connection does not survive a restart | Inspect account-recovery logs; do not infer current availability from old history |

## 7. Related

- [Messaging channels overview](/en/guide/channels) · [Approvals and permissions](/en/guide/approvals) · [Security and data](/en/security)
