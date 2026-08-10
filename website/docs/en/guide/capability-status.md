---
title: Feature and platform status
---

# Feature and platform status

This page defines how the handbook uses status terms such as generally available, conditional, Preview, Hidden, stub, and placeholder. The goal is to prevent source-code presence or one green indicator from being described as a delivered capability.

## 1. Status legend

| Status | Meaning |
|--------|---------|
| Generally available | Reachable from the normal product entry and backed by a real runtime path |
| Conditionally available | Requires a platform, account, permission, connection, or packaging environment |
| Preview | Part of the runtime path exists, but platform or release commitments are limited |
| Hidden / developer | Accessible only through a deep link or development mode; not part of ordinary navigation |
| Stub | A shell, registration entry, or adjacent implementation exists, but the core path is incomplete |
| Coming Soon | An explicit placeholder; not a working feature |
| Blocked | An interface or configuration remains in code, but the current implementation is explicitly unavailable |

## 2. Important current statuses

| Capability | Current status | Description |
|------------|----------------|-------------|
| Home sessions, Experts, Automation, Files, and Market | Generally available | Still require basic prerequisites such as a model and workspace |
| Messaging channels | Conditionally available | WeChat, Feishu/Lark, Telegram, and Discord require real accounts and platform E2E verification |
| Company | Conditionally available | Appears only after OnMyCompany is connected |
| Projects | Coming Soon | Neither the main-rail entry nor the Files classification is a production project-management feature |
| Usage | Hidden deep link | Not currently present in ordinary Settings navigation |
| Debug / UI control | Developer capability | Must not be promoted as an ordinary user feature |
| Windows desktop | Unsigned developer Preview | Computer Use is not fully equivalent to macOS |
| Linux desktop | Not a product target | Linux use in CI or sandboxing does not imply client support |
| Postgres and DuckDB/Quack Archive | Blocked | Must not be demonstrated as connected backends |

## 3. Verification strength

| Claim | Minimum evidence |
|-------|------------------|
| UI exists | A real page screenshot or DOM/navigation evidence |
| Local feature works | Actual startup, execution, persistence/recovery, or artifact verification |
| External integration works | A real platform request and response, including a bidirectional message closed loop when applicable |
| Cross-platform support | A build/device smoke on that platform; do not infer it from another platform |

Typecheck, unit tests, fake APIs, a live process, and `WebSocket open` cannot individually replace user-path verification.

## 4. Version and working tree

Handbooks and videos should identify the recorded version or commit. If the working tree contains uncommitted changes, the visible behavior may differ from a published installer. Rerun screenshots and user paths against the release target before publishing.

## 5. Related

- [Interface and workspaces](/en/guide/overview) · [Projects (Coming Soon)](/en/guide/projects) · [Messaging channels](/en/guide/channels)
- [macOS](/en/install/macos) · [Windows](/en/install/windows) · [Security and data](/en/security)
