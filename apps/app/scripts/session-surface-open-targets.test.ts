import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createAutoOpenSessionState,
  initializeAutoOpenSessionState,
  markAutoOpened,
  resetAutoOpenSessionState,
  shouldFireAutoOpen,
} from "../src/react-app/domains/session/surface/session-surface-open-targets";

describe("auto-open session state (pure)", () => {
  test("empty first init then later targets still allow auto-open", () => {
    // Mirrors real mount: session reset → verify([]) → targets arrive.
    let state = resetAutoOpenSessionState();
    state = initializeAutoOpenSessionState(state, "sess-1", null);
    expect(state.initializedSessionId).toBe("sess-1");
    expect(state.autoOpenedTargetId).toBeNull();

    // Later non-empty verify must NOT re-init / pre-mark (same session).
    const afterTargets = initializeAutoOpenSessionState(
      state,
      "sess-1",
      "artifact-a",
    );
    expect(afterTargets).toBe(state);
    expect(afterTargets.autoOpenedTargetId).toBeNull();

    expect(shouldFireAutoOpen(afterTargets, "artifact-a", false)).toBe(true);

    const opened = markAutoOpened(afterTargets, "artifact-a");
    expect(shouldFireAutoOpen(opened, "artifact-a", false)).toBe(false);
  });

  test("buggy reset-after-empty-init would suppress auto-open (regression guard)", () => {
    // If reset ran after empty init, the next non-empty verify re-initializes
    // and pre-marks the candidate — auto-open must not fire. Document the
    // broken sequence so we never reintroduce reset-after-verify order.
    let state = createAutoOpenSessionState();
    state = initializeAutoOpenSessionState(state, "sess-1", null);
    // Simulated misplaced reset AFTER empty verify:
    state = resetAutoOpenSessionState();
    state = initializeAutoOpenSessionState(state, "sess-1", "artifact-a");
    expect(state.autoOpenedTargetId).toBe("artifact-a");
    expect(shouldFireAutoOpen(state, "artifact-a", false)).toBe(false);
  });

  test("first non-empty init for a session pre-marks so reopen does not re-fire", () => {
    let state = resetAutoOpenSessionState();
    state = initializeAutoOpenSessionState(state, "sess-2", "artifact-a");
    expect(state.autoOpenedTargetId).toBe("artifact-a");
    expect(shouldFireAutoOpen(state, "artifact-a", false)).toBe(false);
  });

  test("session switch clears pre-mark via reset then allows new session open", () => {
    let state = resetAutoOpenSessionState();
    state = initializeAutoOpenSessionState(state, "sess-a", "old");
    expect(shouldFireAutoOpen(state, "old", false)).toBe(false);

    state = resetAutoOpenSessionState();
    state = initializeAutoOpenSessionState(state, "sess-b", null);
    // Empty init already locked sess-b with null — later candidate auto-opens.
    state = initializeAutoOpenSessionState(state, "sess-b", "new");
    expect(state.autoOpenedTargetId).toBeNull();
    expect(shouldFireAutoOpen(state, "new", false)).toBe(true);
  });

  test("streaming suppresses auto-open", () => {
    const state = createAutoOpenSessionState();
    expect(shouldFireAutoOpen(state, "x", true)).toBe(false);
    expect(shouldFireAutoOpen(state, null, false)).toBe(false);
  });
});

describe("open-targets hook source contract", () => {
  test("session reset effect is declared before the verify effect", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/session-surface-open-targets.ts",
      ),
      "utf8",
    );
    const resetIdx = source.indexOf(
      "autoOpenStateRef.current = resetAutoOpenSessionState()",
    );
    const verifyIdx = source.indexOf("async function verifyTargets");
    expect(resetIdx).toBeGreaterThan(0);
    expect(verifyIdx).toBeGreaterThan(0);
    expect(resetIdx).toBeLessThan(verifyIdx);

    // Host must use the extracted hook (not re-implement).
    const host = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/session-surface.tsx",
      ),
      "utf8",
    );
    expect(host).toContain("useSessionSurfaceOpenTargets");
    expect(host).not.toContain("initializedAutoOpenSessionRef");
  });
});
