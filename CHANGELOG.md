# Changelog

All notable changes to OnMyAgent will be documented in this file.

This project follows a lightweight changelog format during early development. Release notes may also appear on GitHub Releases.

## Unreleased

### Added

### Changed

### Security

### License / community

## 0.4.12

### Changed

- **First-install cold path**: stop dual-fetching selected-session title snapshots; only non-empty, non-selected tabs may title-snapshot after 6s; empty chips stay "新会话" without OpenCode hits.
- Session-route prewarm: idle wait 8s; inventory-only (skip duplicate provider.list); sidebar preview defer 4s.

## 0.4.11

### Changed

- Session-route **provider / inventory prewarm** deferred via `requestIdleCallback` (timeout fallback) so first paint does not race `listSessions` and the selected-session snapshot.
- Expert **tab titles**: stop cold thrash (no immediate selected-session title snapshot; idle empty sessions do not poll every 3s); still include selected after defer and recheck once when a run ends (#180).

## 0.4.10

### Added

- Session **rail keep-alive LRU**, virtual measure policy, and deferred sidebar/tab title snapshots (#179).
- Server **session list / snapshot / archive open** policy modules and automation wait policy (#177–#179).
- Automation UX: list model, session groups, provider probe helpers (#176–#177).

### Changed

- Tech-wave hygiene: thin session hosts, archive route extracts, desktop lifecycle spawn, marketplace extracts (#178–#179).
- Expert tab titles: leave the stuck "summarizing" placeholder; derive chip labels from the focused session's messages (#179).
- Provider order / connectivity test and quieter session load paths (#176).
- OpenCode pin / CI desktop contract and automation e2e busy→idle mock (#177–#178).

## 0.4.9

### Added

- Archive **store-pool lifecycle**: status probes use `withSessionArchiveStore`; mutations and POST sync notify the archive change-bus (#174).
- Sidebar **cold-start policy**: list limit, deferred preview snapshots, selected-workspace-only background load (#174).
- Session surface pure **send/plan/goal orchestration** helpers with unit tests (#174).
- Leaf modules to clear import cycles (den types, session page types, sidebar/composer types, `opencode-workspace-client`) (#175).

### Changed

- Provider-auth config/error transforms extracted; store under file-size baseline (#174).
- Desktop composition thin-out: `desktop-workspace-ids` + `runtime-engine-state` (#175).
- Agents page host thinned: `CreateAgentWizard` + shared styles extracted; toast/confirm copy via i18n (#175).
- Extensions-store pure helpers (`formatSkillPath`, gateway capability resolve, initial state factory) (#175).
- `madge --circular` clean for `apps/app` and `apps/server` (#175).

## 0.4.8

### Added

- Shell **route-load registry** + shared `LoadSurface` for boot/route/inset loading chrome (`system.load_*` i18n).
- Progressive boot: dismiss full-screen overlay once workspace shell can paint; sidebar session title cache for cold start.
- Product error templates in `kernel/user-error` with recovery actions on settings route banners.
- Settings AI empty-state dual CTAs, list skeleton, and `useAiProvidersController` / `mergeConnectedProviders`.

### Changed

- Shared provider inventory merge (`mergeConnectedProviders`) for settings AI and session model catalogs.
- Composer model-unavailable control opens AI settings; first-load vs soft-refresh load scopes reduce double-load feel.
- Boot/runtime and reload copy prefer product language (apply/reload) over bare “engine” jargon (en / zh / zh-TW).
- Architecture / domain README / public roadmap notes synced for shell load UX.

## 0.4.7

### Added

- Session goal lifecycle in the composer: preview before send, pause / resume / clear, session-scoped runtime isolation, and Codex-style access modes.
- Messaging domain surfaces for automations and personal-agent channels (Feishu, Weixin, pairing).
- `local-agents` domain for ACP / local agent management, cards, and related UI.
- Design system contracts in root `DESIGN.md` through v5 (motion, focus, state machines, notifications, keyboard, message roles, streaming, presence, tool approval, code/diff, session/artifact variants) plus shell chrome § 4i.
- Guardrails: `check:i18n:cjk`, `check:forbidden-types`, shell-import-depth baselines, and `pnpm task check design` token drift check.
- `FilterChip` free-float category filter primitive (soft `list-selected` active state) and expert marketplace card hover **召唤** CTA (`session.summon` i18n).
- `DesktopCommandMap` + domain IPC handlers under `apps/desktop/electron/desktop-handlers/` (typed desktop bridge).
- Main rail bottom **Devices** icon entry (with channels).
- Safety-net CI: `ui-contracts` suite in `test:ui`, `check:architecture-paths` in `pnpm check`, e2e health-binding scan, desktop-handlers domain smoke.

### Changed

- React app domain extraction: plugins, messaging, local-agents, workspace, shell-feedback, and connections ownership clarified; `shared/` reduced to infra only; former `session/components/shared-pages/` cleared into owner domains.
- Session host route split into `shell/session-route/` folder facade (`index` / `render` / intent / composer modules); settings host remains thin entry + render helpers.
- Desktop `main.mjs` composition root: domain handlers assembled via `createAllDesktopDomainHandlers`; command routing via `desktop-command-router` + `@onmyagent/types` groups.
- Server / orchestrator modularization continues (server composition root; orchestrator CLI modules).
- UI R1–R5 style pass: store/settings tabs, FilterChip light-theme wash, expert cards (borderless default / border on hover), global Updates tab restored.
- `@onmyagent/ui` is React-only (`@onmyagent/ui/react`); Solid export and unused Paper mesh helpers removed.
- Documentation layout under `docs/`: map (`README.md`), `Architecture.md`, `release.md`, `loop/{rules,incidents}.md`, `design/`. Plan/feature draft trees (`docs/plans`, `docs/archive`, `docs/features`) removed and gitignored; use `.loop/`.
- Engineering skills live under `.agents/skills/` with symlinks for Codex/Claude/Grok (`.codex/skills`, `.claude/skills`, `.grok/skills`). Added `CLAUDE.md` → `AGENTS.md` and `skills-audit`.

### Security

- Documented public contribution and support paths for safe issue reporting.

### License / community

- Adopted Apache License 2.0 for the repository and workspace package metadata.
- Added open-source community and release-readiness documentation.
