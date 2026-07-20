# OnMyAgent Computer Use

Native **macOS-only** computer-use runtime for OnMyAgent (Swift / AppKit /
Accessibility / Screen Recording). Packaged OnMyAgent builds wrap this runtime
in a bundled `Computer Use.app` helper so TCC permissions belong to the helper
app instead of a transient Node or Swift process.

| Platform | Helper binary | Composer “capture desktop” (Appshot) | Agent Computer Use tools |
| --- | --- | --- | --- |
| macOS | Built and bundled | Yes (shortcut + menu) | Yes |
| Windows | Not shipped | Hidden; clear “macOS only” copy if invoked | N/A |
| Linux | Not shipped | Same as Windows | N/A |

Windows / Linux desktop shells still boot; they simply skip helper packaging
(`prepare-computer-use-helper` early-returns off `darwin`) and hide Appshot UI.
See [`docs/windows-compat.md`](../../docs/windows-compat.md).

This package focuses on the reusable control layer:

- Semantic AX snapshots with compact refs like `{e1}`.
- Strict background mode that avoids foreground cursor/HID fallbacks.
- Target-window screenshots via `CGWindowListCreateImage(.optionIncludingWindow)`.
- **Appshot** (`appshot capture` / `appshot monitor`): frontmost-app screenshot
  for the composer attachment pipeline (`captureComputerUseAppshot` +
  `onAppshot` IPC). Filenames are built as real `String` slugs
  (`AppshotCaptureStore.makeFileName`); Electron also sanitizes the payload name
  so Swift debug dumps never reach the UI notice/chip.
- Background input through `CGEvent.postToPid` with window-addressing fields.
- Background activation using per-process event taps plus AppKit and center-click primers.
- Non-UI orchestration modules from the original Electron prototype: realtime tool schemas/instructions and the GPT computer-use loop.

Computer Use renders a lightweight second cursor overlay from the helper app so
users can see where the agent is acting. The overlay is visual only: strict mode
does not move the real system cursor. Actual control uses the same
non-interrupting mechanism described in Bridge-style background computer use: AX
first, then `CGEvent.postToPid` addressed to the target process/window, with
per-process focus-message taps and activation primers so the user's frontmost app
can remain frontmost while the target app accepts events. Foreground HID fallback
is only used when strict mode is disabled.

Build the native stdio server (macOS + Xcode tools required):

```bash
pnpm --filter @onmyagent/handsfree check:native
```

Run it as an MCP-compatible adapter:

```bash
pnpm --filter @onmyagent/handsfree exec onmyagent-handsfree-computer-use mcp
```

Manual Appshot capture (JSON on stdout):

```bash
# requires built HandsFreeComputerUse binary
<path-to-helper> appshot capture
```

The core runtime is intentionally MCP-independent. `ComputerUseRuntime` exposes a small direct surface (`snapshot`, `click`, `typeText`, `pressKey`, `scroll`, `wait`, `setValue`, `performAction`); `MCPServer` is only a thin stdio wrapper. Appshot is a separate CLI path (`appshot capture|monitor`) wired through `apps/desktop/electron/computer-use-desktop.mjs`.
