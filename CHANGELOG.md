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

### Changed

- React app domain extraction: plugins, messaging, local-agents, workspace, shell-feedback, and connections ownership clarified; `shared/` reduced to infra only.
- `@onmyagent/ui` is React-only (`@onmyagent/ui/react`); Solid export and unused Paper mesh helpers removed.
- Documentation structure: single map in `docs/README.md`, SoT update table, DESIGN task router, session-goal design under `docs/features/session-goal/`, loop pointers collapsed to `docs/legacy-loop-pointers.md`. Plan ledgers removed from git (`docs/plans/`, `docs/archive/` gitignored; use `.loop/plans/`).

### Security

- Documented public contribution and support paths for safe issue reporting.

### License / community

- Adopted Apache License 2.0 for the repository and workspace package metadata.
- Added open-source community and release-readiness documentation.
