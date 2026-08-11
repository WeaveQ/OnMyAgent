/**
 * Experts / Session invariants — contract index + source anchors.
 *
 * Product rules live in apps/app/AGENTS.md ("Experts / Session 不变量").
 * This file fails CI if those rules are re-broken in the primary call sites.
 * Specialized unit coverage remains in the sibling scripts listed per invariant.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  consumeActiveExpertDraftForSession,
  resolveBoundExpertDraftNavigation,
} from "../src/react-app/domains/session/pages/expert-draft-session";
import {
  resolveExpertDirectoryView,
  shouldBlockExpertSurfaceForWorkspaceError,
} from "../src/react-app/domains/session/pages/expert-directory-view";

const pageViewPath = new URL(
  "../src/react-app/shell/session-route/page-view.tsx",
  import.meta.url,
);
const surfacePropsPath = new URL(
  "../src/react-app/shell/session-route/surface-props-hook-impl.ts",
  import.meta.url,
);
const sessionSyncPath = new URL(
  "../src/react-app/domains/session/sync/session-sync.ts",
  import.meta.url,
);
const sessionLoaderPath = new URL(
  "../src/react-app/shell/session-route/session-loader-hook.ts",
  import.meta.url,
);
const sessionRouteSessionsPath = new URL(
  "../src/react-app/shell/session-route/sessions.ts",
  import.meta.url,
);
const agentSessionStatePath = new URL(
  "../src/react-app/domains/agents/agent-session-state.ts",
  import.meta.url,
);
const appAgentsPath = new URL("../AGENTS.md", import.meta.url);

describe("experts/session invariants index", () => {
  test("apps/app AGENTS.md documents the five expert/session invariants", async () => {
    const agents = await readFile(appAgentsPath, "utf8");
    expect(agents).toContain("## Experts / Session 不变量");
    expect(agents).toContain("空壳禁止 startRun");
    expect(agents).toContain("Expert Directory 权威");
    expect(agents).toContain("Bound draft 事务消费");
    expect(agents).toContain("首发冷路径可见");
    expect(agents).toContain("Snapshot / SSE 代际隔离");
    expect(agents).toContain("expert-session-invariants.test.ts");
  });
});

describe("invariant 1: empty expert shell must not startRun", () => {
  test("onCreateFreshSessionForAgent does not mark runActive", async () => {
    const source = await readFile(pageViewPath, "utf8");
    expect(source).toContain(
      "Do NOT startRun here: this path only opens an empty expert",
    );
    const marker = "onCreateFreshSessionForAgent={async (workspaceId) => {";
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const slice = source.slice(start, start + 8_000);
    expect(slice).not.toMatch(
      /startRun\s*\(\s*workspaceId\s*,\s*newSession\.id\s*\)/,
    );
  });
});

describe("invariant 2: Expert Directory is authoritative for empty landing", () => {
  test("workspace error blocks empty draft; directory loading defers cold open", () => {
    expect(
      shouldBlockExpertSurfaceForWorkspaceError({
        selectedSessionId: null,
        showSelectedWorkspaceError: true,
      }),
    ).toBe(true);
    expect(
      resolveExpertDirectoryView({
        activeChat: true,
        directoryState: "loading",
        hasAnyExpertConversation: false,
        showWorkspaceSetupEmptyState: false,
        showSelectedWorkspaceError: false,
        showBlockingStartupSkeleton: false,
        selectedSessionId: null,
      }),
    ).toMatchObject({
      deferColdOpen: true,
      showLoadingWithoutSelection: true,
      showNoExpertConversation: false,
    });
    expect(
      resolveExpertDirectoryView({
        activeChat: true,
        directoryState: "incomplete",
        hasAnyExpertConversation: false,
        showWorkspaceSetupEmptyState: false,
        showSelectedWorkspaceError: false,
        showBlockingStartupSkeleton: false,
        selectedSessionId: null,
      }),
    ).toMatchObject({
      showIncompleteWithoutSelection: true,
      showNoExpertConversation: false,
    });
  });

});

describe("invariant 3: bound draft is consumed for the same expert only", () => {
  test("consume and navigation helpers enforce same-expert transactional rules", () => {
    const contexts = {
      "order-entry": { label: "active draft" },
      fulfillment: { label: "other draft" },
    };
    expect(
      consumeActiveExpertDraftForSession({
        contexts,
        pendingAgent: { id: "order-entry" },
        draftAgentId: "order-entry",
        draftSessionActive: true,
        targetAgentId: "order-entry",
      }).consumed,
    ).toBe(true);
    expect(
      consumeActiveExpertDraftForSession({
        contexts,
        pendingAgent: { id: "fulfillment" },
        draftAgentId: "fulfillment",
        draftSessionActive: true,
        targetAgentId: "order-entry",
      }).consumed,
    ).toBe(false);

    const navInput = {
      contexts: { "order-entry": { operationId: "operation-101" } },
      draftAgentId: "order-entry",
      draftSessionActive: true,
      pendingAgent: {
        id: "order-entry",
        operationId: "operation-101",
        boundSessionId: "ses_created",
      },
    };
    expect(
      resolveBoundExpertDraftNavigation({
        ...navInput,
        selectedSessionId: "ses_previous",
      }),
    ).toBe("ses_created");
    expect(
      resolveBoundExpertDraftNavigation({
        ...navInput,
        selectedSessionId: "ses_created",
      }),
    ).toBeNull();
  });
});

describe("invariant 4: first-send cold path stays visible", () => {
  test("optimistic seed is ordered before route activation", async () => {
    const source = await readFile(surfacePropsPath, "utf8");
    const seedIdx = source.indexOf(
      "Seed the user turn into the new session transcript",
    );
    const activateIdx = source.indexOf("activateCreatedSessionRoute({");
    expect(seedIdx).toBeGreaterThan(0);
    expect(activateIdx).toBeGreaterThan(seedIdx);
    expect(source).toContain("kickoffMarketplaceExpertInstall(");
    expect(source).toContain("Join early install + env prep");
  });

  test("empty shell create fire-and-forgets marketplace install", async () => {
    const source = await readFile(pageViewPath, "utf8");
    expect(source).toContain(
      "void installMarketplaceExpertAfterSessionCreated(agentToBind)",
    );
    expect(source).not.toContain(
      "await installMarketplaceExpertAfterSessionCreated(agentToBind)",
    );
  });
});

describe("invariant 5: snapshot/SSE generation isolation", () => {
  test("session sync lifecycle tracks generation and aborts stale connections", async () => {
    const source = await readFile(sessionSyncPath, "utf8");
    expect(source).toContain("createSessionSyncConnectionLifecycle");
    expect(source).toContain("generation: number");
    expect(source).toContain("nextGeneration");
    expect(source).toContain("active.controller.abort()");
    expect(source).toMatch(/isActiveConnection/);
  });

  test("session loader uses one workspace aggregate and preserves partial state", async () => {
    const source = await readFile(sessionLoaderPath, "utf8");
    const sessionHelpers = await readFile(sessionRouteSessionsPath, "utf8");
    expect(source).toContain("collectWorkspaceSessionItemsWithStatus");
    expect(sessionHelpers).toContain('scope: "workspace"');
    expect(source).not.toContain("deleteSessionOrigin");
    expect(source).not.toContain("listSessionOrigins");
    expect(source).not.toContain("mergeRecoveredSessionsWithCurrent");
    expect(source).not.toContain("recoverOriginDirectory");
    expect(source).not.toContain("getSession(");
  });

  test("expert identity no longer uses renderer-owned local membership", async () => {
    const [pageView, surface, state] = await Promise.all([
      readFile(pageViewPath, "utf8"),
      readFile(surfacePropsPath, "utf8"),
      readFile(agentSessionStatePath, "utf8"),
    ]);
    expect(pageView).not.toContain("writeCustomAgentIdForSession(newSession.id");
    expect(surface).not.toContain("readCustomAgentIdForSession");
    expect(surface).not.toContain("writeCustomAgentIdForSession");
    expect(state).not.toContain("onmyagent:expertSessionIds");
  });
});
