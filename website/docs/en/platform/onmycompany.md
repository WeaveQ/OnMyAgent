---
title: OnMyCompany
---

# OnMyCompany: Private-Network Control Plane

An optional organization-side component for identity, distribution of organization configuration, Gateway egress, and audit.

## 1. Status: stated explicitly

| Item | Status |
|------|--------|
| Main private-network control-plane pilot path | Server side is relatively mature |
| Desktop connection and configuration mirror | Minimal path is available |
| Mandatory enterprise egress across the full path | Continues to be strengthened |

## 2. Connect the desktop

In OnMyAgent, open [Settings → Company](/en/guide/settings#company):

1. Enter the organization service address
2. Sign in with an enterprise email address and verification code
3. Use **Health check** to confirm that the service is reachable


## 3. Principles

- **Connecting a company is optional**; it is not a prerequisite for local use
- When no company address is configured, OnMyAgent does not make enterprise HTTP requests
- When connected, the desktop must obey organization policy and **must not loosen it locally**

## Related

- [Platform overview](/en/platform/) · [Pilot combinations](/en/platform/pilot-combos) · [Security and data](/en/security)
