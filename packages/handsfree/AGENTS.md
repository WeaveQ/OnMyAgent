# AGENTS.md — HandsFree Computer Use

Scope: `packages/handsfree/**`. Read the root `AGENTS.md` first.

This package is the macOS Computer Use boundary. The accepted behavior and reverse-engineering evidence live in [`docs/design/2026-08-20-computer-use-background-parity.md`](../../docs/design/2026-08-20-computer-use-background-parity.md). Do not copy that document here.

## Hard invariants

1. The default MCP profile exposes only the 10 Sky tools in `ComputerUseBehaviorContract.skyToolNames`.
2. The default profile is always strict. Undeclared `strict: false` input must not enable foreground fallback.
3. Strict actions keep the user's frontmost application and hardware cursor unchanged. Physical user input remains independent and does not pause strict Computer Use.
4. Strict input stays bound to the snapshot PID + CGWindowID and fails closed when that binding, WindowServer capability, foreground PID, or synthetic-input invariant changes.
5. Global HID posting, application activation, and unconditional window ordering remain confined to the explicit compatibility/UI files allowlisted in `computer-use-contract.lock.json`.
6. The virtual cursor remains visual-only, ordered directly above the controlled window, centered on the model action coordinate, persistent for the session, and independent from the system cursor.
7. The accepted cursor presentation remains the Codex vector/fog behavior at the user-approved 2/3 scale unless the user explicitly requests another visual change.

## Protected contract

`computer-use-contract.lock.json` hashes the strict runtime, MCP routing, coordinate conversion, physical-input policy, and virtual-cursor implementation. `scripts/check-computer-use-contract.mjs` also scans every production Swift file for dangerous APIs, including newly added files.

Do not update hashes just to make the check green. A legitimate protected-file change requires all of the following in the same task:

1. An explicit Computer Use behavior or compatibility request.
2. A focused failing regression test before the implementation change when practical.
3. Review of every changed protected file and any dangerous-API exception.
4. Updated hashes only after the implementation is final.
5. All validation commands below passing.

Changes outside the protected set must still pass the contract check; do not route around the strict runtime by adding a new dispatcher or MCP alias.

## Validation

```bash
pnpm --filter @onmyagent/handsfree check:contract
pnpm --filter @onmyagent/handsfree check
pnpm --filter @onmyagent/handsfree test
pnpm task check design
pnpm check:file-size
```

`check:contract` is cross-platform. `check` and `test` require macOS/Xcode because the helper imports AppKit, Accessibility, and ScreenCaptureKit. Live AppKit/Electron background E2E remains opt-in with `ONMYAGENT_COMPUTER_USE_NATIVE_E2E=1`.
