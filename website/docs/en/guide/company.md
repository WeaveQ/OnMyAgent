---
title: Company connection
---

# Company connection

A Company connection links the OnMyAgent desktop app to OnMyCompany and reads organization-provided skills, experts, models, Gateway catalogs, and policy. Local mode must remain fully usable when no Company connection exists.

Product entry: **Settings → Workspace → Company**. **Company** appears on the main rail only after a successful connection.

## 1. Local mode and Company mode

| | Local mode | After Company connection |
|--|------------|--------------------------|
| Is sign-in required? | No | Yes; requires the Company service and a member session |
| Configuration root | `profiles/local` | A `profiles/company` mirror after successful synchronization |
| Policy source | Local product defaults and user choices | Organization policy from the server; the desktop app cannot weaken it locally |
| Skills and experts | Installed locally or created personally | Can also read the organization catalog, which is normally read-only |
| Credentials | Configured by the user | Gateway credentials must not return to the desktop process |

Without a `companyBaseUrl` and a valid member session, OnMyAgent must not send requests to the Company API or create a Company profile in advance.

## 2. Connect a Company

1. In Company settings, enter the OnMyCompany address provided by your organization.
2. Enter your organization email address and complete verification-code sign-in.
3. Wait until the Skills, Experts, Models, Gateway catalog, and policy synchronize successfully.
4. Return to the main interface and confirm that **Company** appears.
5. Browse organization resources on the Company page. Actions requiring administration should open the organization management console rather than bypassing policy from the desktop app.

Use the official address supplied by an organization administrator. Never show the Company domain, email address, verification code, member token, or policy details in a public video.

## 3. Company catalog

| Area | Purpose | Desktop boundary |
|------|---------|------------------|
| Organization Skills | Use organization-approved capabilities in a session | Normally read-only; users cannot arbitrarily change the organization version |
| Organization Experts | Use role experts supplied by the organization | Lifecycle is controlled by organization policy |
| Gateway connectors | Browse available external-service entries | Credentials do not return to the desktop; real calls follow Gateway policy |
| Organization Models | Use models enabled by an administrator | The desktop can only consume the allowlist |
| Policy | View allow, deny, external-send, and permission restrictions | The desktop cannot change a deny decision into allow |

## 4. Configuration synchronization and migration

- Local and Company profiles use isomorphic configuration structures to reduce semantic drift between two systems.
- Migration of legacy Skills and marketplaces copies data and does not delete the original directories.
- The app switches to the Company profile only after Company sign-in and a successful pull.
- Disconnecting returns to the local profile. A synchronized local mirror can remain, but it must not continue to be treated as the live organization source of truth.

## 5. Disconnect and troubleshoot

| Symptom | What to check |
|---------|---------------|
| Cannot connect | Company address health, network, email address, and verification-code lifetime |
| Sign-in succeeds, but Company does not appear | Whether profile pull completed and the member session remains valid |
| Catalog is empty | Whether the organization published resources and the current member is in the allowed scope |
| A resource is visible but unusable | Organization policy, Gateway or model permission, and approval requirements |
| Old data remains after disconnect | Re-enter the local profile; a retained mirror does not mean the app is still connected |

## 6. Current product boundary

OnMyAgent currently owns the desktop app and local Server. OnMyCompany is the control plane for enterprise identity, isolation, policy, approval, audit, and Gateway. Policy presentation or a local evaluator in the desktop app must not be described as a complete enterprise control plane.

## 7. Related documentation

- [Interface and workspace](/en/guide/overview) · [MCP and connectors](/en/guide/mcp) · [Models and BYOK](/en/guide/models)
- [Security and data](/en/security) · [OnMyCompany](/en/platform/onmycompany)
