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

The first public release line targets macOS only. Windows packaging will be added later, and Linux/AUR packaging is intentionally disabled for now.

```bash
pnpm --dir apps/desktop build
```

This prepares sidecars, runtimes, helper apps, server output, and Electron shell files needed by Electron Builder.

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
