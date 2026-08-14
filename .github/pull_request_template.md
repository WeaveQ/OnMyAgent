<!--
  Collaboration language: PR title, description, and commit subjects must be
  English (CI: "PR English"). Product UI copy stays multi-language via i18n.
  Chinese may appear only inside fenced code blocks if needed for repro.

  Suggested labels (path auto-labeler also applies on open/sync):
    Area:  app | desktop | server | orchestrator | packages | ci | i18n | documentation
    Meta:  needs-desktop-smoke | do-not-merge | ci:windows
  Prefer Conventional Commit titles (fix(app): …) — they are the primary signal.

  Windows host CI (windows-2022) is path-filtered and skipped otherwise (cost).
  Triggers: apps/desktop/electron|scripts|build|package.json|electron-builder.yml,
    apps/orchestrator src/tests/scripts/package.json,
    server session-archive / env-file,
    app workspace, session-archive, local-agents, app/lib/desktop.ts,
    scripts/dev/windows*, scripts/dev/headless-web.ts, scripts/lib/run-command.mjs,
    package.json / pnpm-lock / constants.json, docs/windows-compat.md,
    .github/workflows/ci-tests.yml
  Marketplace / bundled-skills content does NOT trigger the host job.
  Force with label **ci:windows**. Local: `pnpm check:windows`.
-->

## Summary
-

## Why
-

## Scope
-

## Testing
- [ ] `pnpm check` (boundaries, i18n CJK, security smoke — matches Checks job)
- [ ] Unit / app scripts touched by this change (`bun test` under `apps/app/scripts` or package tests)
- [ ] Manual desktop smoke (`pnpm dev -- desktop`) if UI or Electron changed
- [ ] Windows: path filter hit **or** label `ci:windows` applied; or local `pnpm check:windows`
- [ ] `Build Electron Desktop` workflow if packaging / installers / notarize behavior changed

## Risk
- [ ] No secrets, runtime artifacts, or local caches included
- [ ] No release/package publishing side effects
- [ ] User-facing copy is covered by i18n when applicable

## Screenshots / Evidence
- N/A

## Rollback
-
