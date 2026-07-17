# Changelog

All notable changes to OnMyAgent will be documented in this file.

This project follows a lightweight changelog format during early development. Release notes may also appear on GitHub Releases.

## Unreleased

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
