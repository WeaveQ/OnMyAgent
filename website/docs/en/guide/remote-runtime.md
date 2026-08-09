---
title: Remote runtimes and sandboxing
---

# Remote runtimes and sandboxing

Advanced users can run a workspace, OpenCode, and routing processes on another machine through OnMyAgent Server and Orchestrator. Agent processes can also run in Docker or Apple container sandboxes.

This page documents an advanced capability; it is not required for first-time setup.

## 1. Component relationships

| Component | Purpose |
|-----------|---------|
| OnMyAgent Server | HTTP API for workspaces, files, sessions, approvals, automation, Archive, and SSE |
| OpenCode | Execution engine for main sessions |
| Orchestrator | Starts and coordinates Server, OpenCode, optional message routing, and sandboxing |
| Desktop | Connects to a local or remote Server and provides the UI and machine-local capabilities |

Expose only OnMyAgent Server for remote access. OpenCode itself uses basic auth and listens on loopback; do not expose it directly to the internet.

## 2. Tokens and permission scopes

- A client token provides ordinary remote access.
- Collaborator, owner, and host tokens have broader write or management capabilities.
- Pairing secrets and raw tokens must never appear in a recording or ordinary log.
- Orchestrator JSON output can contain raw pairing information. Use it only when machine-readable output is truly required, and protect it accordingly.

Remote file, MCP, approval, and management actions are checked again against token scope. Being able to open Home does not mean the token can perform every operation.

## 3. Preflight

1. Use a dedicated data directory and test workspace.
2. Verify the OpenCode version, model credentials, and port policy.
3. Run health/check and event checks.
4. Connect from the client in read-only mode and verify the workspace identity.
5. Enable writes, automation, or message routing only after the earlier checks pass.

## 4. Sandbox modes

| Mode | Behavior |
|------|----------|
| `auto` | Attempts to select Apple container or Docker; may fall back to `none` when neither is available |
| `docker` | Uses a Docker container and Linux sidecar |
| `container` | Uses Apple container; available only in supported macOS arm64 environments |
| `none` | Runs the Agent directly on the host, with no container isolation |

Setting `auto` does not prove that isolation is active. Inspect the backend actually selected for every run.

## 5. Mounts and environment variables

- Mount only the workspace and runtime directories that are required.
- Additional mounts may be rejected for sensitive paths or downgraded from read/write to read-only.
- Do not mount Home, SSH configuration, browser profiles, cloud credentials, or system-configuration directories.
- The sandbox may receive user environment variables and common model API keys. Treat it as a sensitive execution environment.

## 6. Remote pairing and networking

- Protect the remote Server with TLS, a trusted network, or a controlled tunnel.
- Rotate or revoke credentials that are no longer needed after pairing.
- Keep the CORS allowlist, authorized roots, and read-only mode aligned with the real deployment.
- Do not treat a local development port or webhook address as a production public endpoint.

## 7. Troubleshooting

| Symptom | Check |
|---------|-------|
| Client connects, but workspace is missing | Token scope, workspace ID, and authorized roots |
| `auto` provides no isolation | Final backend and whether Docker/Apple container CLI is available |
| Model is unavailable inside the container | Environment forwarding, network, and sidecar architecture/version |
| Files are read-only | Server readOnly, collaborator permission, mount downgrade, and approvals |
| Events do not update | SSE, Server/Archive state, and network proxy |

## 8. Related

- [Workspaces](/en/guide/workspaces) · [Approvals and permissions](/en/guide/approvals) · [Security and data](/en/security)
- [Feature and platform status](/en/guide/capability-status)
