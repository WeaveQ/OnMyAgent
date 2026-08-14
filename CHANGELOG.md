# Changelog

All notable changes to OnMyAgent will be documented in this file.

This project follows a lightweight changelog format during early development. Release notes may also appear on GitHub Releases.

## Unreleased

### Added

### Changed

- Desktop updates: cold start always checks once; a found version downloads only after the user clicks the notice or **Download update**. Checks no longer start a background download on their own.
- Windows: spawn Claude/Codex/Hermes/OpenClaw and editor detection via cmd shims; orchestrator accepts `C:\` binaries and searches LocalAppData OpenCode; artifact skills fall back to copy when junctions fail.

### Security

### License / community

## 0.5.3

### Changed

- macOS desktop releases sign with `Developer ID Application (see CI secret CSC_NAME)` and honor `Release App` `notarize: true`.

## 0.5.2

### Changed

- Smaller packaged desktop: keep only en/zh-CN/zh-TW Electron locales, drop unused office-lib browser/UMD trees, strip npm docs/man, and recompress oversized marketplace icons.

## 0.5.1

### Changed

- Packaged desktop installers drop unused bundled Node/Python extras, duplicate sidecar binaries, and artifact-runtime source maps/types. Windows extra-global Node modules are pruned; PPT viewer hashed font/wasm copies are rewritten to the vendor originals.

## 0.5.0

### Changed

- Packaged / production builds hide the Task Center rail entry. Local `pnpm dev` still shows it.

## 0.4.29

### Added

- Task Center: durable background orchestration (detached Supervisor, alignment, approvals, and run history).

### Fixed

- Windows tray uses the same rounded brand mark as the app window (not the thin outline template glyph).
- Taskbar jump list Computer Control uses the brand app icon instead of a generic monitor glyph.
- Expert marketplace browse grid no longer highlights text when dragging; the search box stays selectable.

## 0.4.28

### Fixed

- Welcome onboarding no longer stays under the boot overlay after cold start (`routeReady` latch on `/welcome`).
- Expert directory identity snapshots are cached so SessionRoute does not hit a Zustand `getSnapshot` / max-update-depth loop.
- Expert create overlay expires when the expert is deleted.
- Expert write identity uses the short package name; archive / ACP scans resolve the real user home.

### Changed

- Desktop/Vite dev bind to `127.0.0.1` and Chromium `--proxy-bypass-list` so Clash / corp proxies do not 502 the renderer.

## 0.4.27

### Added

- Packaged desktop: background auto-update via electron-updater (download in background, restart to install; prereleases are visible).

### Changed

- Settings: unify provider delete / disconnect as **Remove**.

### Fixed

- Expert hard-delete 404 when the UI sent `packageName` as the agentId composite (`pkg:pkg`) while session-origins stores the short package name.

## 0.4.26

### Fixed

- Expert / session UI update loops that could white-screen or peg the renderer (cold-open, tab contract, unread/activity equality).
- Session archive discovery and local-agent ACP probes use the real user home so local archives populate and Grok/Pi-style CLIs stop false unauth when credentials live there.
- Session freeze on archive / agent-home scans.

## 0.4.25

### Added

- OS notifications and quick-capture that work off the session route (pending queue).

### Fixed

- Sidebar filters register new assistant / expert sessions.
- `Content-Disposition` is safe for CJK filenames.

## 0.4.24

### Fixed

- Settings / session can show providers as ready while discovery is still running.

## 0.4.23

### Fixed

- Packaged `file://` empty-state and icon-mask assets resolve.
- Quick-capture HTML ships in packaged builds.

## 0.4.22

### Fixed

- Welcome / splash logo in light mode and vertically centered startup composer.
- Packaged boot crash from asar pnpm symlink materialization (continued from 0.4.21).

## 0.4.21

### Changed

- KOL / creator-ops builtin expert packs refreshed (content, media, project review).

### Fixed

- Packaged desktop no longer crashes on boot (pnpm deploy symlinks inside asar).

## 0.4.20

### Fixed

- Packaged boot crash from missing production server dependencies.
- False “origin degraded” and over-pruning of multi-expert lists.

## 0.4.19

### Added

- Expert runtime isolation (sandboxed OpenCode HOME / lean agent file).
- Expert runtime artifacts visible in Files.
- Settings: drag-reorder model providers.

### Fixed

- Recover summoned expert sessions and durable origin / agentId binding.
- Session activity footer no longer sticks on “model requesting” once text is visible.
- Windows path / spawn / Documents expansion hardening.

## 0.4.18

### Changed

- Settings prefetch high-traffic tabs on enter and nav hover.
- Agent fleet uses a card-grid skeleton instead of a full-page loading mark.
- UI polish: Pi ACP, Ollama/workspace provider delete, automation empty/actions.

### Fixed

- Session-archive SSE teardown no longer kills the desktop on client disconnect.

## 0.4.17

### Added

- Company / OnMyCompany rail, settings, and org catalog sync (skills, experts, connectors).

## 0.4.16

### Added

- Phase 2a local config foundation: `profiles/local` dual-read for skills/experts; boot-time copy migration (legacy retained).
- Work memory (prefs inject + file mirrors).
- Files chrome, projects rail, account avatar menu, and work-memory settings views.

### Changed

- Faster task / expert / session switches (prop-driven, no surface remount).

## 0.4.15

### Changed

- Cold-start **boot overlay / first-screen load** polish: progressive hide and quieter first paint (#187).

## 0.4.14

### Added

- Experts: capability introductions as onboarding guides; logistics marketplace refinements.

### Changed

- Files, Computer Use, terminal, and archive session UX polish.
- Desktop runtime kept within file-size baseline.
- Session/expert stability fixes (tab selection, collapsed previews, terminal capability maps).

## 0.4.13

### Added

- **BrowserSkill Path B**: desktop `browser-skill-desktop` discover/doctor/install guide + bundled skill `browser-skill` (external `bsk` + Chrome/Edge extension); coexists with in-app `browser-runtime` / `browser-automation` (#184).
- Connectors UX polish alongside BrowserSkill setup (#184).
- Experts progressive capability introductions / visualization; composer session file and folder mentions.

### Changed

- Expert first-send and multi-session tab selection stability.
- Personal usage / Codex usage summary UI parity fixes.
- Orchestrator pins `onmyagent-server` to 0.4.13 for strict release review.

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
