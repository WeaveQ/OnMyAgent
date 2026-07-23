import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  archiveDbChangeListenerCount,
  clearArchiveDbChangeBus,
  notifyArchiveDbChanged,
  subscribeArchiveDbChanges,
} from "../src/services/archive-change-bus.js";

const serverRoot = join(import.meta.dir, "..");

describe("archive-change-bus (shipped)", () => {
  test("notifies only listeners for that dbPath", () => {
    clearArchiveDbChangeBus();
    let a = 0;
    let b = 0;
    const offA = subscribeArchiveDbChanges("/db-a", () => {
      a += 1;
    });
    const offB = subscribeArchiveDbChanges("/db-b", () => {
      b += 1;
    });
    expect(archiveDbChangeListenerCount("/db-a")).toBe(1);
    notifyArchiveDbChanged("/db-a");
    expect(a).toBe(1);
    expect(b).toBe(0);
    notifyArchiveDbChanged("/db-b");
    expect(a).toBe(1);
    expect(b).toBe(1);
    offA();
    offB();
    expect(archiveDbChangeListenerCount("/db-a")).toBe(0);
    clearArchiveDbChangeBus();
  });
});

describe("archive SSE change-bus wiring (structural)", () => {
  test("routes notify on sync; SSE module subscribes; HTTP uses withSessionArchiveStore", () => {
    const routes = readFileSync(
      join(serverRoot, "src/routes/workspace-session-archive-routes.ts"),
      "utf8",
    );
    const sse = readFileSync(
      join(serverRoot, "src/routes/workspace-session-archive-sse.ts"),
      "utf8",
    );
    expect(routes).toContain("notifyArchiveDbChanged");
    expect(routes).toContain("withSessionArchiveStore");
    expect(routes).toContain("workspace-session-archive-sse");
    expect(sse).toContain("subscribeArchiveDbChanges");
    expect(sse).toContain("archiveSessionWatchVersion");
    expect(sse).toContain("archiveStatsVersion");
    // Version keys must not be full-object JSON.stringify of session/timing
    expect(sse).not.toMatch(
      /JSON\.stringify\(\s*\{\s*session/,
    );
    expect(sse).not.toMatch(
      /lastVersion\s*=\s*JSON\.stringify\(\s*(input\.)?stats/,
    );
    expect(routes).not.toMatch(
      /const store = await openSessionArchiveStore/,
    );
    expect(sse).not.toMatch(
      /setInterval\(async \(\) => \{[\s\S]{0,200}openSessionArchiveStore/,
    );
  });
});
