---
title: Download and install
---

# Download and install

## Get an installer

Use an official release channel for the current version:

- **GitHub Releases**: <https://github.com/WeaveQ/OnMyAgent/releases>
- Build locally from source: see `BUILD.md` at the monorepo root

> The website does not embed direct links that can become stale. Use the asset names on the Releases page as the source of truth.

## System requirements

| Platform | Status | Notes |
|----------|--------|-------|
| macOS (Apple Silicon / Intel) | **Primary support** | Daily dogfooding and release target |
| Windows | **Developer preview** | See `docs/windows-compat.md` in the monorepo |
| Linux | Not supported | — |

## macOS

1. Download the `.dmg` or the installer for your architecture.
2. Drag the app to Applications, or complete the installer.
3. If macOS shows a security warning on first launch, allow the app under **System Settings → Privacy & Security**.
4. Launch OnMyAgent, then continue with the [Quickstart](/en/quickstart).

More: [Install on macOS](/en/install/macos).

## Windows

1. Use the NSIS installer if it is included in the Release, or build locally with `package:electron`.
2. Launch OnMyAgent from the Start menu after installation.
3. An unsigned build may trigger a SmartScreen warning.

More: [Install on Windows](/en/install/windows).

## Permissions

Depending on the capabilities you use, the operating system may request:

| Capability | Possible permission |
|------------|---------------------|
| Workspace read and write | File and folder access |
| Notifications | Notification permission |
| Computer Use and screenshots | Accessibility and Screen Recording, including on macOS |

## Post-installation checklist

- [ ] Home opens and shows **+ New task**
- [ ] A model can be configured in Settings
- [ ] Files can list the current workspace contents

If a check fails, see [Troubleshooting](/en/install/troubleshooting).
