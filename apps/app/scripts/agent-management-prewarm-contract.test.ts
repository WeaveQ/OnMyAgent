import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  agentManagerCacheKey,
  readCachedAgentManagerSnapshot,
  resetAgentManagerSnapshotStoreForTests,
  writeCachedAgentManagerSnapshot,
} from "../src/react-app/domains/local-agents/agent-management/agent-management-snapshot-store";
import type { AgentManagementSnapshot } from "../src/app/lib/desktop";

const root = path.join(import.meta.dir, "..");

function emptySnapshot(workspaceRoot: string): AgentManagementSnapshot {
  return {
    generatedAt: Date.now(),
    workspaceRoot,
    agents: [],
    skills: [],
    providers: {
      databasePath: "",
      total: 0,
      byAgent: {
        opencode: [],
        codex: [],
        claude: [],
        openclaw: [],
        hermes: [],
      },
    },
    loadedDomains: ["core"],
  };
}

describe("agent management prewarm contract", () => {
  afterEach(() => {
    resetAgentManagerSnapshotStoreForTests();
  });

  test("snapshot store seeds page cache by workspace root", () => {
    const workspaceRoot = "/tmp/ws-prewarm";
    const key = agentManagerCacheKey(workspaceRoot);
    const snapshot = emptySnapshot(workspaceRoot);
    writeCachedAgentManagerSnapshot(key, snapshot, ["core"]);
    expect(readCachedAgentManagerSnapshot(key)?.workspaceRoot).toBe(
      workspaceRoot,
    );
    expect(readCachedAgentManagerSnapshot(key)?.loadedDomains).toContain(
      "core",
    );
  });

  test("session and welcome call agent-management prewarm", () => {
    const modelCatalog = readFileSync(
      path.join(root, "src/react-app/shell/session-route/model-catalog-hook.ts"),
      "utf8",
    );
    expect(modelCatalog).toContain("useSessionRoutePrewarm");

    const sessionPrewarm = readFileSync(
      path.join(root, "src/react-app/shell/session-route/prewarm-hook.ts"),
      "utf8",
    );
    expect(sessionPrewarm).toContain("prewarmAgentManagementCore");

    const welcome = readFileSync(
      path.join(root, "src/react-app/shell/welcome-route.tsx"),
      "utf8",
    );
    expect(welcome).toContain("prewarmAgentManagementCore");

    const page = readFileSync(
      path.join(
        root,
        "src/react-app/domains/local-agents/agent-management/agent-management-page.tsx",
      ),
      "utf8",
    );
    expect(page).toContain("readCachedAgentManagerSnapshot");
    expect(page).toContain("from \"./agent-management-snapshot-store\"");
  });
});
