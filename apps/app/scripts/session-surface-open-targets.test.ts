import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  applyListedFilesToOpenTargets,
  createAutoOpenSessionState,
  initializeAutoOpenSessionState,
  markAutoOpened,
  normalizeVerifiedOpenTargets,
  resetAutoOpenSessionState,
  shouldFireAutoOpen,
} from "../src/react-app/domains/session/surface/session-surface-open-targets";

describe("local space-folder existence merge", () => {
  test("marks mentioned xlsx files existing when they are in the space listing", () => {
    const targets = [
      {
        id: "file:项目目标与口径.xlsx",
        kind: "file" as const,
        value: "项目目标与口径.xlsx",
        name: "项目目标与口径.xlsx",
        preview: "sheet" as const,
        confidence: 65,
        reason: "message",
      },
      {
        id: "file:C:/Users/me/Desktop/work/发布效果.xlsx",
        kind: "file" as const,
        value: "C:/Users/me/Desktop/work/发布效果.xlsx",
        name: "发布效果.xlsx",
        preview: "sheet" as const,
        confidence: 65,
        reason: "message",
      },
    ];
    const merged = applyListedFilesToOpenTargets(targets, [
      { path: "项目目标与口径.xlsx", kind: "file", size: 5120, mtimeMs: 1 },
      { path: "发布效果.xlsx", kind: "file", size: 5900, mtimeMs: 2 },
    ]);
    expect(merged.every((target) => target.exists === true)).toBe(true);
    expect(merged[0]?.size).toBe(5120);
    expect(merged[1]?.size).toBe(5900);
  });

  test("collapses relative and absolute mentions after listing rewrites the path", () => {
    const merged = applyListedFilesToOpenTargets(
      [
        {
          id: "file:返点毛利计划单.xlsx",
          kind: "file",
          value: "返点毛利计划单.xlsx",
          name: "返点毛利计划单.xlsx",
          preview: "sheet",
          confidence: 95,
          reason: "write tool metadata",
        },
        {
          id: "file:/users/me/.onmyagent/spaces/session1/返点毛利计划单.xlsx",
          kind: "file",
          value: "/Users/me/.onmyagent/spaces/session1/返点毛利计划单.xlsx",
          name: "返点毛利计划单.xlsx",
          preview: "sheet",
          confidence: 65,
          reason: "message",
        },
      ],
      [{ path: "返点毛利计划单.xlsx", kind: "file", size: 7000, mtimeMs: 1 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.value).toBe("返点毛利计划单.xlsx");
    expect(merged[0]?.exists).toBe(true);
    expect(merged[0]?.size).toBe(7000);
  });

  test("rewrites truncated Application Support leftovers to the listed relative path", () => {
    const merged = applyListedFilesToOpenTargets(
      [
        {
          id: "file:support/com.differential.onmyagent/expert-sessions/ws/agent/1/output/点位周报.xlsx",
          kind: "file",
          value:
            "Support/com.differential.onmyagent/expert-sessions/ws/agent/1/output/点位周报.xlsx",
          name: "点位周报.xlsx",
          preview: "sheet",
          confidence: 65,
          reason: "message",
        },
      ],
      [{ path: "output/点位周报.xlsx", kind: "file", size: 18800, mtimeMs: 3 }],
    );
    expect(merged[0]?.exists).toBe(true);
    expect(merged[0]?.value).toBe("output/点位周报.xlsx");
    expect(merged[0]?.name).toBe("点位周报.xlsx");
  });
});

describe("verified open-target normalization", () => {
  test("upgrades Office files misclassified by an older server", () => {
    const targets = normalizeVerifiedOpenTargets([
      {
        id: "file:合同输出/返点合同.docx",
        kind: "file",
        value: "合同输出/返点合同.docx",
        name: "返点合同.docx",
        preview: "external",
        confidence: 92,
        reason: "assistant delivery manifest",
        exists: true,
      },
    ]);

    expect(targets[0]?.preview).toBe("document");
  });
});

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
  test("passes the current session workspace root to artifact resolution", () => {
    const hook = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/session-surface-open-targets.ts",
      ),
      "utf8",
    );
    expect(hook).toContain("{ sessionRoot: input.sessionRoot }");

    const host = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/session-surface.tsx",
      ),
      "utf8",
    );
    expect(host).toContain("sessionRoot: props.sessionFileRoot?.trim() || props.workspaceRoot");

    const client = readFileSync(
      join(import.meta.dir, "../src/app/lib/onmyagent-server/client-workspace.ts"),
      "utf8",
    );
    expect(client).toContain("sessionRoot: options?.sessionRoot");
  });

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
