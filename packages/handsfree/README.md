# OnMyAgent Computer Use

Native **macOS-only** computer-use runtime for OnMyAgent (Swift / AppKit /
Accessibility / Screen Recording). Packaged OnMyAgent builds wrap this runtime
in a bundled `Computer Use.app` helper so TCC permissions belong to the helper
app instead of a transient Node or Swift process.

| Platform | HandsFree helper (this package) | Composer Appshot | Agent Computer Use tools |
| --- | --- | --- | --- |
| macOS | Built and bundled | Electron `desktopCapturer` + Settings shortcuts | Yes (HandsFree MCP, on by default when staged) |
| Windows | Not shipped | Same Electron path | Yes via **desktop Cua Driver** (not this package; MCP default off) |
| Linux | Not shipped | Same Electron path | No helper yet |

**Appshot** is Electron-only (`desktopCapturer` + customizable
`globalShortcut`). This package remains the **macOS Computer Use** runtime (AX,
MCP, Skysight). Windows / Linux skip HandsFree packaging
(`prepare-computer-use-helper` early-returns off `darwin`). Windows agent CU is
wired in `apps/desktop` (Cua), not here. See
[`docs/windows-compat.md`](../../docs/windows-compat.md).

This package focuses on the reusable control layer:

- Semantic AX snapshots with compact refs like `{e1}`.
- Strict background mode that avoids foreground cursor/HID fallbacks.
- Target-window screenshots via `CGWindowListCreateImage(.optionIncludingWindow)`.
- Historical **Appshot** CLI in Swift is reference only (product capture is Electron).
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

The core runtime is intentionally MCP-independent. `ComputerUseRuntime` exposes a small direct surface (`snapshot`, `click`, `typeText`, `pressKey`, `scroll`, `wait`, `setValue`, `performAction`); `MCPServer` is only a thin stdio wrapper.
