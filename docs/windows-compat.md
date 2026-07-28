# Windows compatibility

OnMyAgent's primary target is macOS. Linux and Windows are supported at the
architecture layer (`process.platform` branches, `electron-builder` targets),
but macOS is where release engineering and daily dogfooding happen. This doc
captures the concrete gotchas we already know about so a first-time Windows
run has a fighting chance.

## CI gate (PR required)

Layered gate (Phase A):

| Layer | When | Job | What |
|-------|------|-----|------|
| **L1** | every PR | Checks (ubuntu + macos) | `pnpm check` + rename; **Linux only**: `test:windows-runtime` (mocked win32) |
| **L2** | path match **or** label | Windows compat (`windows-2022`) | Real host: `test:windows-runtime` + preflight `--ci` |
| **L3** | release / later | (not PR) | NSIS package / install smoke — see Roadmap |

| Job | OS | Why |
|-----|-----|-----|
| **Detect Windows-relevant paths** | ubuntu | Path filter + optional force label |
| **Checks** | ubuntu + macos | Cheap fail-fast; mock Windows contracts on Linux |
| **Windows compat** | `windows-2022` | Real host; **skipped** unless paths match or label |
| **Typecheck** | via Checks only | TS is OS-agnostic — not re-run on Windows |

**Path filter** (any match → run Windows host job):

- `apps/desktop/**`, `apps/orchestrator/**`
- `apps/server/src/services/session-archive*`, `apps/server/src/env-file.ts`, `apps/server/tests/session-archive*`
- `apps/app/src/react-app/domains/workspace/**`
- `apps/app/src/react-app/domains/session/chat/session-archive*`
- `apps/app/src/app/lib/desktop.ts`
- `scripts/dev/windows*`, `scripts/lib/run-command.mjs`
- `package.json`, `pnpm-lock.yaml`, `constants.json`
- `.github/workflows/ci-tests.yml`, `docs/windows-compat.md`

**Force host gate (no path match required):** add PR label **`ci:windows`**.  
Workflow listens for `labeled` / `unlabeled` so applying the label re-runs detection.

**Not duplicated:** desktop typecheck; macos does not run windows-runtime.  
**Intentional double-run:** `test:windows-runtime` on Linux (fail-fast) + Windows (host), only when host job is selected.

Locally:

```bat
pnpm check:windows
:: or separately:
pnpm test:windows-runtime
node scripts/dev/windows-preflight.mjs --ci
```

When your PR touches archive parsers, workspace file roots, or desktop bridges but
is not auto-selected, add label `ci:windows` or run `pnpm check:windows` before merge.

## Preflight

```bat
:: from an elevated PowerShell or Developer Prompt so symlinks work
node scripts/dev/windows-preflight.mjs
```

Modes (`ONMYAGENT_WINDOWS_PREFLIGHT_MODE`):

- **`strict`** (default): any failed check exits 1 — use for first local dogfood.
- **`ci`**: only **required** checks fail (node/pnpm/constants/USERPROFILE/electron dist). Docker, symlink privilege, runtimes/sidecars, native rebuild artifacts are optional warnings.

The preflight checks:

- Node, pnpm, `constants.json` versions
- `USERPROFILE`, repo and home on the same volume (junctions cannot cross volumes)
- `vswhere.exe` (needed for `dev:windows`)
- Docker Desktop `docker.exe` in one of the well-known install paths
- Symlink creation privilege (Developer Mode or admin)
- `electron@39.8.10/dist` extracted (see below for the `path.txt` gotcha)
- `apps/desktop/resources/{runtimes,sidecars}` presence
- `node-pty` win32 prebuild and `better-sqlite3` native binding

Run it after every `pnpm install` and before your first `pnpm dev`.

## Known gotchas

### Electron post-install `dist` extraction

If `node_modules/.pnpm/electron@39.8.10/.../dist/` only contains
`LICENSES.chromium.html` after `pnpm install`, the electron post-install
script silently failed to extract the zip. Manually unzip the cached
archive and write `path.txt` (no trailing newline) — `printf`, not `echo`:

```bat
cd node_modules\.pnpm\electron@39.8.10\node_modules\electron
tar -xf "%LOCALAPPDATA%\electron\Cache\electron-v39.8.10-win32-x64.zip" -C dist
:: PowerShell:
:: [System.IO.File]::WriteAllText("$PWD\path.txt", "electron.exe")
```

### Symlinks and junctions

`prepareOnMyAgentOpencodeConfigDir` used to call `fs.symlink(..., "junction")`
and swallow errors. It now falls back to a recursive copy via
`linkOrCopyDir` in `apps/desktop/electron/runtime.mjs`. That means:

- Windows without Developer Mode / admin still boots; the skills directory is
  materialized as a real copy instead of a link.
- Junctions cannot cross volumes. If your repo is on `D:` and your user
  profile is on `C:`, the copy fallback kicks in automatically.

If you want the fast symlink path, enable Windows Developer Mode:
Settings → Privacy & Security → For Developers → Developer Mode.

### Docker Desktop discovery

`resolveDockerCandidates` (in `apps/desktop/electron/runtime.mjs`) and the
orchestrator PATH augmentation (`apps/orchestrator/src/env-paths.ts`) now
check the three standard Docker Desktop locations on Windows:

- `%ProgramFiles%\Docker\Docker\resources\bin\docker.exe`
- `%ProgramFiles(x86)%\Docker\Docker\resources\bin\docker.exe`
- `%LOCALAPPDATA%\Programs\Docker\Docker\resources\bin\docker.exe`

If your install is elsewhere, set `ONMYAGENT_DOCKER_BIN` to the absolute path.

### macOS-only features gracefully degrade

- **Computer Use / HandsFree helper**: `packages/handsfree` is Swift/AppKit
  and macOS-only. `prepare-computer-use-helper.mjs` early-returns on
  `process.platform !== "darwin"`. UI entry points hide Computer Use setup
  and the composer **capture desktop (Appshot)** action off macOS.
- **Appshot (composer desktop capture)**:
  - **Native**: only the macOS helper implements `appshot capture|monitor`.
  - **Electron**: `isComputerUseAppshotSupported()` / `captureComputerUseAppshot`
    refuse non-`darwin` hosts with an explicit “macOS only” error.
  - **Renderer**: menu item is gated on macOS; success uses a short composer
    **notice** (not a full-name toast). Filenames are sanitized in Electron and
    the UI so bad native names never dump into the chip.
  - **Windows reserved names / illegal path chars** are stripped in the shared
    sanitizer even though Appshot itself does not run on Windows (defensive
    for any future capture path that reuses the helper).
- **Sandbox profiles**: `apps/orchestrator/src/runtime-sandbox.ts` returns
  an empty profile on non-macOS. Orchestrator still runs, but without
  `sandbox-exec` isolation.
- **`.env` file `chmod 0o600`**: `apps/server/src/services/env-file.ts`
  catches the Windows no-op. Secret files are readable by other Windows
  users unless you set NTFS ACLs manually.
- **Titlebar drag / vibrancy / traffic lights**: `apps/desktop/electron/main.mjs`
  only applies them on `darwin`. Windows gets the standard system frame.
  `mac:titlebar-drag` / `mac:titlebar-no-drag` Tailwind utilities gate on
  the `.onmyagent-platform-mac` class so they are inert elsewhere.

### Native modules

`better-sqlite3` and `node-pty` are listed in
`pnpm-workspace.yaml`'s `onlyBuiltDependencies`. On Windows CI we pin
`windows-2022` (VS 2022) so `node-gyp` can find the toolchain. Local dev on
Windows needs "Desktop development with C++" from the Visual Studio
Installer. `scripts/dev/windows.cmd` locates `VsDevCmd.bat` and injects it
before invoking `pnpm dev:windows`.

### Python runtime

`apps/desktop/scripts/prepare-runtimes.mjs` already ships checksums for
`aarch64-pc-windows-msvc` and `x86_64-pc-windows-msvc` python-build-standalone
archives. `browser-use[cli]` resolves Windows wheels via pip markers; the
macOS-only `pyobjc-*` chain is skipped automatically.

### Terminal shell

`code-terminal-manager.mjs` uses `%COMSPEC%` (default `powershell.exe`)
on Windows. `node-pty` uses conpty/winpty transparently. If your
`%COMSPEC%` is not set, we fall back to `powershell.exe`.

## Build

Local build:

```bat
pnpm install
scripts\dev\windows.cmd
:: or, targeting the specific arch you want:
scripts\dev\windows.cmd x64
```

Packaged installer:

```bat
pnpm --filter @onmyagent/desktop package:electron
:: outputs an NSIS installer under apps/desktop/dist-electron/
```

Windows code signing is not wired up in `electron-builder.yml`. Users will
see a SmartScreen warning until a signing certificate + `signtool` config
is added.

## CI

`.github/workflows/build-electron-desktop.yml` includes a
`windows-2022` matrix job that runs
`pnpm --filter @onmyagent/desktop package:electron:dir`. It does not
currently run `test:runtime` or an installer smoke; those are on the
Windows roadmap.

## Feature parity today

| Area | macOS | Windows |
|------|-------|---------|
| Electron shell / renderer | ✓ | ✓ |
| Vite dev server | ✓ | ✓ |
| OpenCode sidecar | ✓ | ✓ (`opencode.exe`) |
| Orchestrator sidecar | ✓ | ✓ (`.exe`) |
| Bundled Node + Python | ✓ | ✓ |
| `browser-use` agent | ✓ | ✓ (Chromium via CDP) |
| `packages/handsfree` Computer Use | ✓ | — (macOS-only; helper not packaged) |
| Composer Appshot (desktop capture) | ✓ | — (menu hidden; capture API rejects) |
| `sandbox-exec` isolation | ✓ | — (no isolation) |
| Titlebar vibrancy | ✓ | — (system frame) |
| Docker Desktop integration | ✓ | ✓ (auto-detect) |
| Code signing | ✓ notarized | — (SmartScreen warning) |
| NSIS installer packaging | — | ✓ (unsigned preview) |

## Roadmap

- [ ] Windows installer signing (`signtool`, EV cert)
- [ ] Windows `test:runtime` smoke in CI
- [ ] NSIS installer smoke (install → launch → quit) on `windows-2022`
- [ ] Recovery panel copy pass for Windows-specific paths
- [ ] Investigate WSL2 fallback for `sandbox-exec` equivalent
- [ ] Optional: Windows desktop-capture path for Appshot (not HandsFree AX)

## Fixed recently (kill tree + open terminal)

- **Adapter child-process cleanup**: personal-agent adapters and the legacy harness go through shared `terminateProcessTree` / `terminateProcessTreeByPid` in `apps/desktop/electron/personal-agent-runtime/utils.mjs`. On Windows that issues `taskkill /T /F` so agent CLI grandchildren are reaped; on POSIX it signals the process group (`SIGTERM` → grace → `SIGKILL`). Pure plan helper: `resolveProcessTreeKillPlan`.
- **"Open terminal" for workspace target**: `resolveWindowsTerminalLaunch` in `apps/desktop/electron/code-workspace-actions.mjs` cascades `wt.exe -d <path>` → `powershell.exe -NoExit -Command Set-Location` → `cmd.exe /K cd /D <path>`. It no longer uses `cmd /c start "" <path>` (Explorer file association).

### How to run Windows runtime checks

```bash
# Any host (macOS/Linux CI included) — unit tests mock win32:
pnpm --filter @onmyagent/desktop test:windows-runtime
# or:
node scripts/dev/windows-runtime-test.mjs

# On a Windows machine, also run env preflight:
node scripts/dev/windows-preflight.mjs
```

## Known gaps not yet fixed

These are tracked, but each needs a follow-up PR:

- **opencode binary discovery on Windows**: the runtime now looks under `%LOCALAPPDATA%\opencode\bin\opencode.exe` and `%LOCALAPPDATA%\Programs\opencode\opencode.exe` as well as PATH. If your install lives elsewhere, set `OPENCODE_BIN` or `ONMYAGENT_LOCAL_OPENCODE_BIN`.
