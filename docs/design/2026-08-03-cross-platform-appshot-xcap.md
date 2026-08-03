# Appshot capture (Electron-only) — superseded design

**Branch:** `feat/cross-platform-appshot-xcap`  
**Status:** **Superseded** — Rust/xcap helper removed.

## Final product path

| Concern | Implementation |
| --- | --- |
| Capture | Electron `desktopCapturer` (`computer-use-appshot.mjs`) |
| Menu | Composer → Capture desktop |
| Hotkey | Settings → Shortcuts → **App snapshot** (default `CommandOrControl+Shift+A`, customizable via `globalShortcut`) |
| Platforms | macOS / Windows / Linux desktop shells |
| Permissions | OnMyAgent / Electron Screen Recording (macOS) |

## Why not Rust

- Menu and normal accelerators do not need a native binary.
- Dual-⌘ / dual-Ctrl were the only reason for a native hook; product uses a standard accelerator instead.
- Extra cargo toolchain and black-frame TCC issues on helper children were pure cost.

## Related code

- `apps/desktop/electron/computer-use-appshot.mjs`
- `apps/app/src/react-app/kernel/keymap.ts` (`appSnapshot`)
- `apps/desktop/electron/desktop-system-prefs.mjs` (`registerAppSnapshotHotkey`)
