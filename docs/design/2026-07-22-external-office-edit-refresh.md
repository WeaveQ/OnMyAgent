# External Office Editing and Live Preview Refresh

## Goal

Let users open a locally previewed Office or PDF file in its system-associated desktop application, then refresh the existing OnMyAgent preview automatically whenever either that application or an agent saves the file.

This extends the current preview flow. It does not embed an editor, replace the existing Office renderers, or change the browser, terminal, review, file-tree, outline, or thumbnail interactions.

## Scope

Supported preview targets are the local file types already accepted by the artifact preview controller:

- documents such as DOC and DOCX;
- spreadsheets such as XLS and XLSX;
- presentations such as PPT and PPTX;
- PDF files.

Remote workspaces and unsupported files do not receive the edit action. The system-associated application determines the actual editing capability. On macOS this may be Word, Excel, PowerPoint, WPS, Preview, Acrobat, or another user-selected application; Windows follows the corresponding file association.

## User experience

Both the session Files side panel and the workspace Files page show an **Edit** action for a local Office or PDF preview. The action sits in the existing preview header so the native `WebContentsView` remains limited to the content viewport.

Selecting **Edit** opens the exact file in the system-associated application. On success the current preview remains visible. If no application is associated or the operating system rejects the request, OnMyAgent shows an existing error toast and leaves the preview unchanged.

Saving from the external application or modifying the same file through an agent refreshes the active preview without requiring the user to reselect the file. Rapid consecutive writes resolve to the final stable version rather than repeatedly rendering intermediate content.

## Architecture

### Validated open-for-editing command

The artifact preview controller owns the open-for-editing operation. It reuses the same canonical-path and registered-workspace validation used by preview loading, then calls Electron `shell.openPath`. A non-empty result from `shell.openPath` is returned as a failure.

The renderer reaches this operation through the existing artifact-preview preload and IPC namespace. The generic `__openPath` desktop command is not used for this button because it does not enforce the artifact preview workspace boundary.

### Active-file monitoring

The controller monitors at most one path: the active preview file. Monitoring is path-oriented so application save strategies that replace the original inode are detected. The monitor remains associated with the active preview and is disposed when the target changes or the preview controller is destroyed.

Changes are identified from file metadata, including modification time and size. Notifications are debounced before reading so multi-step saves and agent writes do not render partial files. A transient missing or unreadable file is retried for a bounded period while the last valid preview remains displayed.

### Refresh delivery

For Office files, the controller reads the stable bytes again and sends a new artifact payload containing the updated modification time. The existing viewer key remounts the renderer from that payload.

For PDF files, the existing local `file://` preview is reloaded after the stable change is detected.

The same path handles external application saves and agent modifications; no agent-specific refresh protocol is introduced.

### Renderer integration

The session Files side panel and workspace Files page use a shared edit action that is visible only when all of the following are true:

- the target is a local Office or PDF file;
- Electron artifact preview APIs are available;
- an absolute validated file path is available.

User-visible labels and errors use the existing English, Simplified Chinese, and Traditional Chinese locale modules. Buttons use the existing shared button primitive and titlebar no-drag contract where required.

## Failure handling

- Path outside a registered local workspace: reject without opening.
- Missing or non-file target: reject without opening.
- No associated desktop application: show an error toast.
- File temporarily absent during atomic save: retain the last preview and retry.
- File permanently deleted: stop retrying and report the preview as unavailable on the next explicit load.
- Preview switched while an asynchronous refresh is in flight: discard the stale result.
- Window or controller destroyed: remove monitors, timers, and pending refresh work.

## Testing

Automated coverage includes:

- open-for-editing path validation and operating-system error propagation;
- IPC and preload contract coverage;
- Office payload refresh after in-place and atomic-replacement saves;
- PDF reload after a stable change;
- debounce behavior for rapid writes;
- stale refresh suppression when switching files;
- monitor and timer cleanup;
- edit-action visibility in both file surfaces;
- localization and design-contract checks.

Manual verification opens representative DOCX, XLSX, PPTX, and PDF files from both file surfaces, saves them in their associated desktop applications, modifies them through an agent, and confirms the visible preview updates without disturbing the surrounding side-panel tools.

## Non-goals

- Embedding Word, Excel, PowerPoint, WPS, or a browser Office editor.
- Choosing a particular desktop application instead of the operating-system association.
- Collaborative editing, merge conflict resolution, or file locking.
- Refreshing every file in the workspace when no preview is active.
- Changing the current Office rendering engine or PDF `file://` strategy.
