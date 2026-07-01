# OnMyAgent Orchestrator

Host orchestrator for opencode + OnMyAgent server + opencode-router. This is a CLI-first way to run host mode without the desktop UI.

Published on npm as `onmyagent-orchestrator` and installs the `onmyagent` command.

## Quick start

```bash
npm install -g onmyagent-orchestrator
onmyagent start --workspace /path/to/workspace --approval auto
```

When run in a TTY, `onmyagent` shows an interactive status dashboard with service health, ports, and
connection details. Use `onmyagent serve` or `--no-tui` for log-only mode.

```bash
onmyagent serve --workspace /path/to/workspace
```

`onmyagent` ships as a compiled binary, so Bun is not required at runtime.

If npm skips the optional platform package, `postinstall` falls back to downloading the matching
binary from the `onmyagent-orchestrator-v<version>` GitHub release. Override the download host with
`ONMYAGENT_ORCHESTRATOR_DOWNLOAD_BASE_URL` when you need to use a mirror.

`onmyagent` downloads and caches the `onmyagent-server`, `opencode-router`, and `opencode` sidecars on
first run using a SHA-256 manifest. Use `--sidecar-dir` or `ONMYAGENT_SIDECAR_DIR` to control the
cache location, and `--sidecar-base-url` / `--sidecar-manifest` to point at a custom host.

Use `--sidecar-source` to control where `onmyagent-server` and `opencode-router` are resolved
(`auto` | `bundled` | `downloaded` | `external`), and `--opencode-source` to control
`opencode` resolution. Set `ONMYAGENT_SIDECAR_SOURCE` / `ONMYAGENT_OPENCODE_SOURCE` to
apply the same policies via env vars.

By default the manifest is fetched from
`https://github.com/WeaveQ/onmyagent/releases/download/onmyagent-orchestrator-v<version>/onmyagent-orchestrator-sidecars.json`.

OpenCode Router is optional. If it exits, `onmyagent` continues running unless you pass
`--opencode-router-required` or set `ONMYAGENT_OPENCODE_ROUTER_REQUIRED=1`.

For development overrides only, set `ONMYAGENT_ALLOW_EXTERNAL=1` or pass `--allow-external` to use
locally installed `onmyagent-server` or `opencode-router` binaries.

Add `--verbose` (or `ONMYAGENT_VERBOSE=1`) to print extra diagnostics about resolved binaries.

OpenCode hot reload is enabled by default when launched via `onmyagent`.
Tune it with:

- `--opencode-hot-reload` / `--no-opencode-hot-reload`
- `--opencode-hot-reload-debounce-ms <ms>`
- `--opencode-hot-reload-cooldown-ms <ms>`

Equivalent env vars:

- `ONMYAGENT_OPENCODE_HOT_RELOAD` (router mode)
- `ONMYAGENT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS`
- `ONMYAGENT_OPENCODE_HOT_RELOAD_COOLDOWN_MS`
- `ONMYAGENT_OPENCODE_HOT_RELOAD` (start/serve mode)
- `ONMYAGENT_OPENCODE_HOT_RELOAD_DEBOUNCE_MS`
- `ONMYAGENT_OPENCODE_HOT_RELOAD_COOLDOWN_MS`

Or from this monorepo source tree:

```bash
pnpm dev -- orchestrator -- \
  start --workspace /path/to/workspace --approval auto --allow-external
```

Package-private development commands are still available when you need to work inside this package directly:

```bash
pnpm --filter onmyagent-orchestrator dev -- \
  start --workspace /path/to/workspace --approval auto --allow-external
```

When `ONMYAGENT_DEV_MODE=1` is set, orchestrator uses an isolated OpenCode dev state for config, auth, data, cache, and state. OnMyAgent's repo-level `pnpm dev` commands enable this automatically so local development does not reuse your personal OpenCode environment.

The command prints pairing URLs by default and withholds live credentials from stdout to avoid leaking them into shell history or collected logs. Use `--json` only when you explicitly need the raw pairing secrets in command output.

Use `--detach` to keep services running and exit the dashboard. The detach summary includes the
OnMyAgent URL and a redacted `opencode attach` command, while keeping live credentials out of the detached summary.

## Sandbox mode (Docker / Apple container)

`onmyagent` can run the sidecars inside a Linux container boundary while still mounting your workspace
from the host.

```bash
# Auto-pick sandbox backend (prefers Apple container on supported Macs)
onmyagent start --sandbox auto --workspace /path/to/workspace --approval auto

# Explicit backends
onmyagent start --sandbox docker --workspace /path/to/workspace --approval auto
onmyagent start --sandbox container --workspace /path/to/workspace --approval auto
```

Notes:

- `--sandbox auto` prefers Apple `container` on supported Macs (arm64), otherwise Docker.
- Docker backend requires `docker` on your PATH.
- Apple container backend requires the `container` CLI (https://github.com/apple/container).
- In sandbox mode, sidecars are resolved for a Linux target (and `--sidecar-source` / `--opencode-source`
  are effectively `downloaded`).
- Custom `--*-bin` overrides are not supported in sandbox mode yet.
- Use `--sandbox-image` to pick an image with the toolchain you want available to OpenCode.
- Use `--sandbox-persist-dir` to control the host directory mounted at `/persist` inside the container.

### Extra mounts (allowlisted)

You can add explicit, validated mounts into `/workspace/extra/*`:

```bash
onmyagent start --sandbox auto --sandbox-mount "/path/on/host:datasets:ro" --workspace /path/to/workspace
```

Additional mounts are blocked unless you create an allowlist at:

- `~/.config/onmyagent/sandbox-mount-allowlist.json`

Override with `ONMYAGENT_SANDBOX_MOUNT_ALLOWLIST`.

## Logging

`onmyagent` emits a unified log stream from OpenCode, OnMyAgent server, and opencode-router. Use JSON format for
structured, OpenTelemetry-friendly logs and a stable run id for correlation.

```bash
ONMYAGENT_LOG_FORMAT=json onmyagent start --workspace /path/to/workspace
```

Use `--run-id` or `ONMYAGENT_RUN_ID` to supply your own correlation id.

OpenCode runs at `INFO` by default, which produces large log files in
`~/.local/share/opencode/log/`. Pass `--opencode-log-level <DEBUG|INFO|WARN|ERROR>` (or set
`ONMYAGENT_OPENCODE_LOG_LEVEL`) to forward `--log-level` to managed `opencode serve` and reduce log
volume.

OnMyAgent server logs every request with method, path, status, and duration. Disable this when running
`onmyagent-server` directly by setting `ONMYAGENT_LOG_REQUESTS=0` or passing `--no-log-requests`.

## Router daemon (multi-workspace)

The router keeps a single OpenCode process alive and switches workspaces JIT using the `directory` parameter.

```bash
onmyagent daemon start
onmyagent workspace add /path/to/workspace-a
onmyagent workspace add /path/to/workspace-b
onmyagent workspace list --json
onmyagent workspace path <id>
onmyagent instance dispose <id>
```

Use `ONMYAGENT_DATA_DIR` or `--data-dir` to isolate router state in tests.

## Pairing notes

- Use the **OnMyAgent connect URL** and **client token** to connect a remote OnMyAgent client.
- The OnMyAgent server advertises the **OpenCode connect URL** plus optional basic auth credentials to the client.

## Approvals (manual mode)

```bash
onmyagent approvals list \
  --onmyagent-url http://<host>:8787 \
  --host-token <token>

onmyagent approvals reply <id> --allow \
  --onmyagent-url http://<host>:8787 \
  --host-token <token>
```

## Health checks

```bash
onmyagent status \
  --onmyagent-url http://<host>:8787 \
  --opencode-url http://<host>:4096
```

## File sessions (JIT catalog + batch read/write)

Create a short-lived workspace file session and sync files in batches:

```bash
# Create writable session
onmyagent files session create \
  --onmyagent-url http://<host>:8787 \
  --token <client-token> \
  --workspace-id <workspace-id> \
  --write \
  --json

# Fetch catalog snapshot
onmyagent files catalog <session-id> \
  --onmyagent-url http://<host>:8787 \
  --token <client-token> \
  --limit 200 \
  --json

# Read one or more files
onmyagent files read <session-id> \
  --onmyagent-url http://<host>:8787 \
  --token <client-token> \
  --paths "README.md,notes/todo.md" \
  --json

# Write a file (inline content or --file)
onmyagent files write <session-id> \
  --onmyagent-url http://<host>:8787 \
  --token <client-token> \
  --path notes/todo.md \
  --content "hello from onmyagent" \
  --json

# Watch change events and close session
onmyagent files events <session-id> --onmyagent-url http://<host>:8787 --token <client-token> --since 0 --json
onmyagent files session close <session-id> --onmyagent-url http://<host>:8787 --token <client-token> --json
```

## Smoke checks

```bash
onmyagent start --workspace /path/to/workspace --check --check-events
```

This starts the services, verifies health + SSE events, then exits cleanly.

## Local development

Point to source CLIs for fast iteration:

```bash
onmyagent start \
  --workspace /path/to/workspace \
  --allow-external \
  --onmyagent-server-bin apps/server/src/cli.ts
```
