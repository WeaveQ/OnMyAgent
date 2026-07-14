---
name: browser-use-agent
description: Internal instructions for delegating a conversation goal to the dedicated upstream Browser Use Agent runtime.
---

# Browser Use Agent runtime

This skill is internal to the Browser Use Agent expert. Submit the user's browser goal unchanged to the dedicated `browser-use-agent` runtime. The runtime owns browser/model credentials, action approvals, cancellation, and tab cleanup.

Do not invoke the legacy Browser Use CLI or reconstruct browser actions in shell commands. Do not print runtime environment variables. Treat approval rejection as an action result and continue only when the remaining task is safe.
