# Build Guide

This file is the **local desktop packaging** runbook only (prepare sidecars, `package:electron`, `package:electron:dir`).

| Topic | Doc |
| --- | --- |
| Everyday dev commands | `README.md` |
| GitHub release / tags / signing / notarize | **`docs/release.md`** (SoT) |
| Release scripts | `scripts/release/*` |
| Full doc map | `docs/README.md` |
| Architecture | `docs/Architecture.md` |
| Security | `SECURITY.md` |

Do not document production release secrets or tag flows here — keep them in `docs/release.md`.

## Prerequisites

Before packaging, make sure the normal development baseline works:

```bash
pnpm dev
pnpm task build app
pnpm check
```

Required local tools:

- Node.js from `.nvmrc` and `package.json#engines`.
- `pnpm@10.27.0`.
- Bun `1.3.9+`.
- Xcode Command Line Tools on macOS.
- Network access for first-time runtime downloads, unless runtime archives are already cached.

Electron download settings in `.npmrc` must stay aligned with the Electron version in `apps/desktop/package.json`.

## Build The Web UI

```bash
pnpm task build app
```

This builds the React UI in `apps/app` and shared UI package dependencies.

## Build Desktop Artifacts

Run desktop package scripts from the repository root.

Primary release and signing target is **macOS**. **Windows** has an unsigned NSIS developer-preview path (`pnpm --filter @onmyagent/desktop package:electron` on a Windows host or via CI `windows-2022`); see [`docs/windows-compat.md`](./docs/windows-compat.md). **Linux/AUR** packaging remains intentionally disabled.

```bash
pnpm --dir apps/desktop build
```

This prepares sidecars, runtimes, helper apps, server output, and Electron shell files needed by Electron Builder.
`apps/desktop/server/` is gitignored staging from this script (`pnpm deploy` of `onmyagent-server`); do not hand-edit it. `prepare:sidecar` only stages OpenCode / orchestrator binaries under `resources/sidecars`.

## Package Desktop Locally

### macOS Directory Package

Use this for fast packaging smoke tests. It avoids creating a distributable installer and is the safest local verification target.

```bash
pnpm --dir apps/desktop package:electron:dir
```

### macOS Distributable Package

```bash
pnpm --dir apps/desktop package:electron
```

Package output is written under `apps/desktop/dist-electron/`.

Electron Builder accepts architecture flags after the package script command:

```bash
pnpm --dir apps/desktop package:electron -- --mac --arm64 --publish never
pnpm --dir apps/desktop package:electron -- --mac --x64 --publish never
```

### macOS local ad-hoc package (no Apple Developer ID)

For smoke-testing a DMG/`.app` on the **build Mac** without a Developer ID
certificate, use ad-hoc signing (`identity: "-"`) plus Hardened Runtime
entitlements (`build/entitlements.mac.plist`: `allow-jit`,
`disable-library-validation`, …):

```bash
pnpm --dir apps/desktop package:electron:local
# .app only (faster):
pnpm --dir apps/desktop package:electron:local -- --dir
```

This is **not** a substitute for release signing + notarization. Ad-hoc builds
still fail Gatekeeper when copied via WeChat/browser quarantine; clear with
`xattr -cr /path/to/OnMyAgent.app` on the same machine, or open from
`dist-electron/mac-arm64/` without re-downloading.

If a sidecar target must be prepared explicitly, run the desktop helper first:

```bash
TARGET=x86_64-apple-darwin pnpm --dir apps/desktop prepare:sidecar
pnpm --dir apps/desktop package:electron -- --mac --x64 --publish never
```

## Runtime Cache

`apps/desktop/scripts/prepare-runtimes.mjs` reads `constants.json` for bundled Node and Python versions.

Runtime archives are cached under `apps/desktop/resources/runtime-downloads/` by default. To use another cache directory:

```bash
ONMYAGENT_RUNTIME_DOWNLOAD_DIR=/absolute/path pnpm --dir apps/desktop package:electron:dir
```

To require pre-cached archives and forbid network downloads:

```bash
ONMYAGENT_RUNTIME_OFFLINE=1 pnpm --dir apps/desktop package:electron:dir
```

## Recommended Verification

Before handing off a packaging change, run the relevant checks:

```bash
pnpm check:type
pnpm task build app
pnpm --dir apps/desktop typecheck:electron
pnpm --dir apps/desktop package:electron:dir
```

For runtime, sidecar, or updater changes, launch the packaged `.app` from `apps/desktop/dist-electron/` and perform a smoke test against a local workspace.

### Grok Build runtime packaging gate

The default `system` Grok Build profile discovers the user's installed binary
and keeps the existing `~/.grok` home in place. It must not copy, rewrite, or
delete the user's auth, model, or session files. A future `bundled` profile may
ship only when every supported OS/architecture has an official pinned artifact,
SHA-256, audited source revision, Apache-2.0 license, required third-party
notices, and a checker that rejects missing or mismatched assets. Until that
manifest is complete, packaged builds must fail closed for `binaryMode=bundled`
rather than silently falling back to an unverified download.

For a runtime-changing package, verify both the ordinary OpenCode default and
the explicitly selected Grok `system` profile. Record the actual runtime badge,
health/version, permission mode, sticky reopen, exact child cleanup, and confirm
that no provider secret or `GROK_HOME` path appears in renderer-visible output.

## Common Issues

### Electron Download Fails

Check `.npmrc`:

```bash
cat .npmrc
pnpm --dir apps/desktop exec electron --version
```

`electron_custom_dir` must match the Electron version resolved from `apps/desktop/package.json`.

### Missing Runtime Archives

Run packaging with network access or provide cached archives through `ONMYAGENT_RUNTIME_DOWNLOAD_DIR`.

### Code Signing Or Notarization

Signing, notarization, and release upload are handled by the release pipeline and `scripts/release/*`. Local packaging commands should use `--publish never` unless you are intentionally running release automation.
