---
title: Workspaces
---

# Workspaces

A workspace binds sessions, files, and the directories an Agent may access to a clear scope. It can be a folder on this machine or a remote workspace provided by another OnMyAgent Server.

Product entry: the workspace selector at the top of the main interface. Some operations can also be opened from the command palette or Settings.

## 1. Local and remote workspaces

| | Local workspace | Remote workspace |
|--|-----------------|------------------|
| File location | An authorized folder on the current computer | The device hosting the remote OnMyAgent Server |
| Connection | Local Desktop and Server | Server URL plus client token |
| Best for | Everyday office work, private files, and desktop tools | Remote machines, long-running work, or access across devices |
| Management permissions | Current desktop user | Depends on token scope; some operations require host or owner permission |

A remote workspace does not expose the entire remote host. OnMyAgent still checks paths against the workspace registered with the server and its authorized roots.

## 2. Create a local workspace

1. Open the workspace selector and choose to create a local workspace.
2. Select a dedicated folder. Do not use your entire home directory, `.ssh`, or a cloud-credentials directory as a workspace.
3. Give it a recognizable name.
4. Wait for the local Server and OpenCode engine to become ready before creating the first session.

OnMyAgent maintains the necessary workspace configuration on this machine. Removing a workspace entry and deleting the original files are not the same action; read each confirmation dialog carefully.

## 3. Add a remote workspace

1. Prepare the remote OnMyAgent Server address and client token.
2. Under **Add Remote Workspace**, provide the address, target workspace, and authentication.
3. Run connection diagnostics and confirm the health result, authorization scope, and workspace identity.
4. Open a read-only file or create a test session to verify that the actual path belongs to the intended remote device.

Never expose a complete token in a screenshot, video, log, or chat. A regular client token may not authorize administration, pairing, or host-level operations.

## 4. Workspaces and sessions

- Both the session URL and session identity include workspace ownership.
- When a session is opened from the command palette, OnMyAgent locates that session's workspace instead of defaulting to the first workspace in the list.
- A missing workspace or session should show a not-found or selection prompt; it must not silently fall back to a different workspace.
- New tasks, Settings, Files, and quick actions should preserve the workspace context derived from the current URL.

## 5. Workspaces and files

- Importing a user file usually creates a copy inside the workspace. Whether the original changes depends on the chosen operation.
- Reading, writing, renaming, moving, and deleting are constrained by authorized roots, read-only mode, collaborator permissions, approvals, and revision conflict protection.
- Uploading a file to a remote workspace happens through the remote service; do not assume a local path exists on the remote host.
- Verify Agent output independently in [Files and deliverables](/en/guide/files).

## 6. Rename, share, and diagnose

| Operation | Description |
|-----------|-------------|
| Rename | Changes the display name in OnMyAgent; it does not rename the directory on disk |
| Share or remote access | Creates or displays remote connection information; protect the token and its scope |
| Diagnose | Checks the Server, engine, workspace ID, authorization, and network |
| Remove | Before removing an entry, confirm whether it affects local configuration or a remote connection; do not use it as a file cleanup tool |

## 7. Security guidance

- Put only the files the current task truly needs in each workspace.
- Use an isolated test workspace for demonstrations and Automation.
- Do not add Home, `.ssh`, keychain exports, browser profiles, or cloud-credential directories as extra mounts.
- If a remote connection reports an unexpected workspace or host identity, stop immediately instead of attempting a write.

## 8. Related documentation

- [Sessions](/en/guide/sessions) · [Files and deliverables](/en/guide/files) · [Remote runtimes and sandboxing](/en/guide/remote-runtime)
- [Approvals and permissions](/en/guide/approvals) · [Security and data](/en/security)
