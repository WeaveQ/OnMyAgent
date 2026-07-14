import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL(
    "../src/react-app/domains/session/surface/session-surface.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("session interruption path", () => {
  test("captures goal elapsed time before the transcript state updater runs", () => {
    const recordStart = source.indexOf("const recordSessionInterruption");
    const recordEnd = source.indexOf("useEffect(() => {", recordStart);
    const recordBlock = source.slice(recordStart, recordEnd);

    expect(recordBlock.indexOf("const elapsedMs")).toBeGreaterThan(-1);
    expect(recordBlock.indexOf("const elapsedMs")).toBeLessThan(
      recordBlock.indexOf("setTranscriptNoticesBySessionId"),
    );
    expect(recordBlock).toContain("goalElapsedMs(goalRuntime, now)");
  });

  test("passes the displayed goal runtime into the stop recorder", () => {
    const pauseStart = source.indexOf("const pauseGoalRuntime");
    const pauseEnd = source.indexOf("const handleAbort", pauseStart);
    const pauseBlock = source.slice(pauseStart, pauseEnd);

    expect(pauseBlock).toContain(
      "isGoalIntentRuntime(props.goalRuntime)",
    );
    expect(pauseBlock).toContain(
      'recordSessionInterruption("stopped", runtime)',
    );
  });
});
