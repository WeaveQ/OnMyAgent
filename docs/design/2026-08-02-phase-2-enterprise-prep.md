# Phase 2 — config foundation + enterprise (B-side) control prep

| Field | Value |
| --- | --- |
| Status | **Active roadmap SoT** (engineering + product alignment) |
| Date | 2026-08-02 |
| Product names | **OnMyAgent** = desktop; **OnMyCompany** = internal enterprise control plane (not a public multi-tenant SaaS SKU) |
| Related | [`2026-08-02-config-consistency.md`](./2026-08-02-config-consistency.md), [`2026-08-02-work-memory-plan.md`](./2026-08-02-work-memory-plan.md) |

## 1. Why Phase 2

Phase 1 (and prior) shipped a **local-first office desktop**: sessions, files, automations, skills/experts, local approvals.

**Phase 2** does two things in order:

1. **Finish the desktop config foundation** so local and future company configs share one schema (copy-not-delete migration, dual-read, no logged-out company traffic).
2. **Prepare for B-side (enterprise) control** without breaking mode A (logged-out full local use).

B-side here means **OnMyCompany-class capabilities**: identity, workspace isolation, org policy, approvals, audit, gateway egress — **for internal / pilot deploy**, not public enterprise SaaS marketing.

## 2. Product layering (fixed)

```text
Desktop                          Enterprise (intranet)
OnMyAgent          ←── connect ──►   OnMyCompany
Local office workspace               Multi-user · isolation · policy · approval · audit
Mode A: no login                     (in-process Gateway = OpenConnector-class capability)
Mode B: company session              Credentials stay server-side
```

| Name | Shape | Audience | Duty |
| --- | --- | --- | --- |
| **OnMyAgent** | Desktop | Individual / employee machine | Local office agent workspace |
| **OnMyCompany** | Intranet server | Team / org (not public B2B storefront) | Identity, isolation, policy, approval, audit, gateway egress |
| **OpenConnector** | Implementation detail | Engineers only | Gateway runtime **inside** OnMyCompany — **not** a third product line |

## 3. Phase map

| Phase | Focus | User-visible |
| --- | --- | --- |
| **0 / 1 (done baseline)** | Local office product | Logged-out full use |
| **2a — Config foundation** | `profiles/local/config` migrate + resolve; isomorphic schema for company later | Near zero-feel; legacy skills/marketplaces retained |
| **2b — Desktop dual-mode shell** | `companyBaseUrl`, auth client, `activeProfile`, data partition keys | “Connect company” entry; no login wall (D1) |
| **2c — Company MVP (intranet)** | Email login, workspace isolation, policy effective, gateway path | Two users cannot see each other’s workspaces by default |
| **2d — Control loops** | Approvals + audit export + policy deny UX | Business owner can see who did what |
| **Later** | Feishu login, catalog push of skills/experts, optional UserData backup | Org publishes capabilities |

### 2a status (engineering)

| Item | Status |
| --- | --- |
| Design SoT `config-consistency` | Landed |
| Path resolve dual-read | Landed (`config-profile-paths.mjs`) |
| Boot migrate copy-not-delete | Landed (`ensure-local-config-migrated.mjs`) |
| Wire desktop-paths + expert-marketplace + runtime skill root | Landed |
| Company profile / OrgConfig HTTP | **Not started** (Phase 2b+) |
| Delete legacy `skills` / `marketplaces` | **Forbidden** |

## 4. Hard product decisions (do not drift)

| ID | Decision |
| --- | --- |
| **D1** | Logged-out users keep full local workspace; show “connect company”, never a hard login wall |
| **B1** | After company login, default enterprise workspace; settings can switch back to local-only |
| **C1** | Respect server `egress.mode`; `gateway_required` blocks local secrets for sensitive kinds |
| **Config** | `local` and `company` **same schema**; switch pointer, not product logic |
| **Secrets** | Never in config export; provider secrets never return to desktop from gateway |
| **Memory body** | Stays under `data/user/awareness/**`; switches may live in `config/memory/settings.json` |
| **Open to public B2B** | **No** this phase — internal / pilot only |

## 5. Desktop track (OnMyAgent) — Phase 2 next work

Order for implementers (Agent-A style):

1. Keep **2a** green (tests + dual-read + no company tree when logged out).
2. **AuthMode** `local | company` + persist `companyBaseUrl` (settings).
3. Email login / logout / identity chip (mock company OK first).
4. Storage partition: `local/...` vs `company/{memberId}/...`; session `origin`.
5. Pull `GET /policy/effective` (or mock); policy bar; deny copy cites org policy.
6. Gateway client + optional audit event POST (no local provider secret).
7. Only then Feishu login polish.

**Non-goals on desktop:** implement company DB, policy editor admin site, or gateway secret storage.

## 6. Enterprise track (OnMyCompany) — prep only in this monorepo

This monorepo remains **desktop + local server**. Company server may live as a **future package / sibling service**. Until then:

| Prep in OnMyAgent repo | Meaning |
| --- | --- |
| Config schema isomorphism | Company config can mirror without rewrite |
| Documented API shape | See product knowledge base API draft + collaboration entry |
| Dual-mode UX contracts | Connect / disconnect / policy messaging |
| No logged-out company calls | Enforce in desktop clients |

Do **not** ship a half-enterprise control plane inside Electron that becomes a second source of truth for policy.

## 7. Config schema (shared)

```text
profiles/{local|company}/config/
  manifest.json
  models.json            # declarations, no keys
  policy.json            # deny/allow/egress
  memory/settings.json   # switches only
  skills/
  experts/
  tools/{mcp,gateway}.json
```

Details: [`2026-08-02-config-consistency.md`](./2026-08-02-config-consistency.md).

## 8. Acceptance (Phase 2 entry)

| # | Scenario | Pass |
| --- | --- | --- |
| 1 | Fresh install, no company URL | Full local office; no company HTTP |
| 2 | Upgrade with existing skills | Migrate copy; legacy dirs remain; skills load |
| 3 | Second boot after migrate | Idempotent; manifest `complete` |
| 4 | Migrate failure | Dual-read legacy; app usable |
| 5 | Connect company (when implemented) | Login optional; can return to mode A |
| 6 | Two company users (when server exists) | Default workspace isolation |

## 9. Doc map for Phase 2

| Doc | Role |
| --- | --- |
| **This file** | Phase 2 roadmap + B-side prep SoT |
| `config-consistency.md` | Local profile migrate + resolve |
| `work-memory-plan.md` | Awareness paths; dual-mode memory rules |
| `docs/Architecture.md` | Engineering boundaries + Phase 2 pointer |
| `AGENTS.md` | Agent hard entry for Phase 2 |
| Public README* | One-line honesty: local-first; org control is roadmap / pilot |

## 10. Changelog

| Date | Note |
| --- | --- |
| 2026-08-02 | Phase 2 roadmap SoT; B-side prep without public SaaS claim |
