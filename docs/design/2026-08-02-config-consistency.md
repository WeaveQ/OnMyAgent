# Config consistency — local / company isomorphic profiles

| Field | Value |
| --- | --- |
| Status | Active engineering SoT (desktop P0–P1) |
| Date | 2026-08-02 |
| Product notes | Knowledge base: 产品分层 / 双模式 / 配置迁移阶段2 / OnMyCompany API 配置草案 |
| Related | [`2026-08-02-work-memory-plan.md`](./2026-08-02-work-memory-plan.md) |

## 1. One-liner

**`local` and `company` share one config schema.** Switching profiles changes the pointer and source of truth — not product logic.

| Layer | Consistent | Intentionally different |
| --- | --- | --- |
| Schema | `manifest`, `models`, `policy`, `memory/settings`, `skills`, `experts`, `tools/*` | — |
| Resolve / UI | Single `activeConfig` consumer path | — |
| Source of truth | local = disk; company = OrgConfig mirror | Write rights: local writable; company mostly read-only |
| Secrets | Never in config export | Local keys / company Connections stay out of tree |
| User body data | Never in config | Awareness / chat / workspace paths |
| Logged-out | `activeProfile=local` only; never create or pull company | — |

## 2. On-disk layout (local required)

```text
~/.onmyagent/
  profiles/
    local/
      config/
        manifest.json
        models.json              # optional; no API keys
        policy.json              # optional; empty = permissive local default
        memory/
          settings.json          # switches only (not MEMORY body)
        skills/                  # was ~/.onmyagent/skills
        experts/
          installed/             # was marketplaces/experts
          mine/                  # was marketplaces/my-experts
        tools/
          mcp.json
          gateway.json           # local default {}
    company/config/              # NOT created until login (later)
  data/user/awareness/           # work-memory body (not config)
  skills/                        # LEGACY backup; never deleted by migration
  marketplaces/                  # LEGACY backup; never deleted
```

## 3. Hard rules

1. Default `activeProfile = local`. Logged-out must not call company APIs.
2. Migration **copies** config-class data only (skills, expert marketplaces; optional memory settings later).
3. **Never** delete `~/.onmyagent/skills` or `marketplaces/`.
4. **Never** migrate workspace, session-archive, channels, or API keys.
5. Migration failure → dual-read / legacy fallback; product stays usable.
6. Work-memory **body** stays under `data/user/awareness/**`; switches may live under `config/memory/settings.json` (P3).
7. Expert **install packages** live under `config/experts/**`; user slots **C** stay in awareness.

## 4. Resolve semantics

```text
read migration.status from profiles/local/config/manifest.json

resolveLocalSkillsRoot(home):
  if status == complete → profiles/.../skills
  else if profile skills non-empty → profile
  else → ~/.onmyagent/skills

resolveLocalExpertsRoot(home, "experts"|"my-experts"):
  complete → experts/installed | experts/mine
  else dual-read same as skills
```

Writes: after `status=complete`, install paths **only** target the profile tree (create dirs as needed).

## 5. Delivery slices

| Step | Deliverable | Logged-out impact |
| --- | --- | --- |
| **P0** | Path helpers + dual-read resolve (no copy) | None if callers still use legacy only |
| **P1** | `ensureLocalConfigMigrated` + boot hook; copy skills + experts; manifest | Should be zero-feel; legacy retained |
| **P2** | New installs write profile paths only | None |
| **P3** | `memory/settings.json` / `models.json` from prefs (no secrets) | None |
| **Later** | `company` mirror + OrgConfig pull | Login only |

This doc’s **first code drop = P0 + P1** (resolve + migrate + wire skills/experts roots).

## 6. Code map (repo)

| Concern | Location |
| --- | --- |
| Paths + resolve | `apps/desktop/electron/config-profile-paths.mjs` |
| Migration | `apps/desktop/electron/ensure-local-config-migrated.mjs` |
| Boot | `desktop-paths.ensureOnMyAgentUserDataDirs` |
| Skills root | `onmyagentUserSkillsRoot` → resolve |
| Experts root | `expert-marketplace.onmyagentMarketplaceRoot` → resolve |
| Tests | `*.test.mjs` next to modules |

## 7. Out of scope (this drop)

- Company profile creation / OrgConfig HTTP
- UserData cloud sync
- Approval as config
- Moving session-archive or Electron userData

## 8. Acceptance (P0–P1)

| # | Case | Pass |
| --- | --- | --- |
| 1 | Logged-out upgrade | No login wall; skills/experts still load |
| 2 | After migrate | Profile tree has copy; **legacy dirs remain** |
| 3 | Second boot | Idempotent; `migration.status=complete` |
| 4 | Kill mid-migrate | Resume or legacy fallback still works |
| 5 | Fresh user | Empty profile tree OK; no throw |
| 6 | Offline | Full local |
| 7 | No company URL | No company requests |

## 9. Changelog

| Date | Note |
| --- | --- |
| 2026-08-02 | Initial SoT; implement P0+P1 on desktop |
