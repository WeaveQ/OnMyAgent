# In-app browser sidebar convergence

Date: 2026-08-24
Status: awaiting written-spec review

## 1. Problem

The session side panel must keep workspace tools visible as peer tabs. Opening
Browser from Files should append a `Browser` tool tab after the existing Files
tab, while `BrowserPanel` keeps page tabs inside that selected tool. Browser
page requests that open a new window must also become OnMyAgent page tabs.

Renderer popovers cannot cover native `WebContentsView` content. The same
occlusion affects both the in-app browser and Office file previews, so tool
menus appear clipped. Browser chrome also lacks a download surface, persistent
history, and page zoom controls. In the Files tool, the file list consumes
preview width and its existing resize/collapse affordance is not discoverable.

## 2. Goals

1. Keep the workspace tool tab row visible when Browser is active, with page
   tabs rendered inside the Browser tool.
2. Keep all HTTP/HTTPS new-window navigation inside OnMyAgent and scoped to the
   originating chat session.
3. Ensure renderer popovers and dialogs always appear above native browser and
   Office previews.
4. Make the Files list visibly resizable, collapsible, and restorable.
5. Replace the browser address-row close action with Downloads and More
   actions.
6. Track real downloads and browser history across app restarts.
7. Provide current-page zoom and history through the More menu.
8. Deliver each slice with focused tests and its own commit.

## 3. Non-goals

- Printing is not included in this iteration.
- Device emulation, browser DevTools, Cookie/password import, autofill,
  clearing all browser data, and a general browser settings page are excluded.
- Unsupported new-window protocols are not forwarded to the OS.
- This work does not change agent browser ownership or approval contracts.
- This work does not replace Electron `WebContentsView` with an iframe.

## 4. Architecture

Electron remains the source of truth for native browser tabs, navigation,
downloads, history, and zoom. React renders chrome and sends explicit commands
through the preload bridge. Durable browser metadata is stored below Electron
`userData`, never in a workspace or renderer-owned store.

The renderer owns a shared native-preview occlusion policy. Browser and Office
preview hosts both consult it before attaching their `WebContentsView`. When a
menu, popover, dialog, or alert dialog is visible, the native view detaches;
when the occluder disappears, the existing animation-frame/bounds loop
reattaches it at the current bounds.

The outer workspace panel remains responsible for switching between Files,
Terminal, Browser, Review, and Automations and always renders that tool row.
`BrowserPanel` owns only its inner page-tab row and navigation controls. The
inner row stays hidden for a single page and appears when multiple pages need
switching.

## 5. Staged implementation

### Stage 1: native preview occlusion

- Add one shared renderer predicate for visible native-preview occluders.
- Cover Base UI menus/popovers and ARIA dialog/alert-dialog surfaces.
- `EmbeddedBrowserViewport` and `OfficeFilePreview` hide while occluded and
  restore automatically after the overlay closes.
- Do not rely on CSS `z-index`; native views always sit above renderer DOM.

Acceptance:

- The tool chooser is fully visible and clickable above a web page.
- The tool chooser is fully visible and clickable above an Office/Excel
  preview.
- Closing the chooser restores the same preview without losing selection.

### Stage 2: Files list width and collapse

- Keep the list/preview separator draggable with a wide pointer hit target.
- Add an always-visible collapse button in the list header while a preview is
  open.
- Double-clicking the separator collapses the list.
- When collapsed, the preview occupies the full Files surface and its header
  exposes an expand button.
- Expanding restores the last non-collapsed width.
- Arrow Left/Right on the separator adjusts width in fixed steps.
- Remember width and collapsed state locally; switching preview files does not
  force the list open.
- When no file is selected, the list occupies the full surface and cannot be
  collapsed into an empty pane.

Acceptance:

- A spreadsheet preview gains all available horizontal space when the list is
  collapsed.
- Collapse, expand, drag, double-click, and keyboard resize preserve the active
  file.

### Stage 3: persistent workspace tool row

- Keep the outer Files/Terminal/Browser tool row visible when Browser is active.
- Append the Browser tool after already-open tools rather than replacing them.
- Render session-scoped page tabs inside the Browser tool only when more than
  one page is open.
- Preserve tab selection, close, reorder, favicon/loading state, and native
  titlebar no-drag behavior.
- Keep the outer `+` action as the workspace tool chooser. The Browser page row
  keeps its own `+` action for creating another in-app page tab.

Acceptance:

- Choosing Browser after Files shows `Files` followed by `Browser` in the outer
  workspace tool row and selects Browser.
- Browser page tabs appear below the outer tool row when multiple pages are open.
- Switching away and back restores the session's page tabs.

### Stage 4: internal new-window routing

- Intercept each browser `WebContentsView` window-open request.
- Accept only HTTP and HTTPS URLs.
- Create a user-owned browser tab carrying the source tab's `sessionId`, select
  it, and keep the side panel open.
- Deny unsupported or malformed URLs without invoking `shell.openExternal`.

Acceptance:

- `target=_blank` and `window.open()` create a new OnMyAgent tab in the same
  chat session.
- No system browser opens for those HTTP/HTTPS requests.

### Stage 5: Downloads

- Replace the address-row close icon with Downloads and More icon buttons.
- Subscribe once to the persistent in-app browser Electron session's real
  download lifecycle.
- Track a bounded list containing id, source URL, filename, save path, received
  bytes, total bytes, state, start/update time, and completion time.
- Normalize states to downloading, completed, cancelled, interrupted, and
  missing. Reconcile completed paths on read so moved/deleted files display as
  missing without deleting their record.
- Persist records atomically below `userData/browser-runtime` and restore them
  at startup.
- The Downloads popover shows progress/status. Completed existing files can be
  opened or revealed in their folder; unavailable files keep their history row.

Acceptance:

- A real webpage download appears immediately, progresses, and settles.
- Records survive an app restart.
- Missing files are labeled rather than silently removed.

### Stage 6: More menu, zoom, and history

- The More menu contains page zoom and History.
- Zoom provides decrement, current percentage, increment, and reset to 100%.
  It applies to the current native page tab and is reflected in browser state.
- Record committed HTTP/HTTPS main-frame navigation with title, URL, and visit
  time. Coalesce consecutive duplicates and keep a bounded persistent history.
- History opens as a renderer list. Choosing an item opens it inside the
  current session; if the selected tab is not user-owned, create a user tab
  instead of mutating an agent-owned tab.
- All download/history/menu popovers participate in native-preview occlusion.

Acceptance:

- Zoom controls update the visible page and displayed percentage.
- History survives restart and never opens the system browser.
- Menus remain completely visible over native previews.

## 6. Persistence and limits

- Browser records live under `userData/browser-runtime` using versioned JSON.
- Writes use a temporary file followed by rename to avoid partial state.
- Invalid or future-version data fails closed to an empty list and does not
  prevent browser startup.
- Download and history records are bounded; the implementation plan will use a
  focused constant with tests for trimming and duplicate coalescing.
- No credentials, cookies, page content, or form values are copied into these
  metadata files.

## 7. Error handling

- A failed persistence write leaves the in-memory browser usable and logs a
  bounded diagnostic without exposing paths in user-facing copy.
- A failed file open/reveal leaves the download entry visible and reports a
  localized error.
- A stale tab/session id rejects the action without falling back to global tab
  state.
- Unsupported window-open protocols are denied.
- Closing an overlay always releases its occlusion state, including unmount and
  error paths.

## 8. Testing and verification

Each stage begins with a failing behavior test and ends with its focused suite
passing before commit.

- Renderer tests: occluder detection, Files collapse/restore, workspace tool and
  Browser page-tab headers, Downloads/More controls, and session-scoped history actions.
- Electron tests: window-open routing, download lifecycle normalization,
  persistence/restore/trim, history coalescing, zoom, and IPC contracts.
- Regression gates: `pnpm task check app`, `pnpm task check desktop`,
  `pnpm task check design`, `pnpm check:boundaries`, `pnpm check:file-size`,
  relevant UI/runtime suites, production app build, and `git diff --check`.
- Visual verification covers dark/light chrome and browser/Office preview
  overlays without taking over the user's external browser or hardware cursor.

## 9. Commit ledger

The implementation will keep one tested commit per stage:

1. native preview occlusion;
2. Files list resize/collapse discoverability;
3. persistent workspace tool row with inner Browser page tabs;
4. internal new-window routing;
5. persistent downloads;
6. More menu zoom and persistent history.
