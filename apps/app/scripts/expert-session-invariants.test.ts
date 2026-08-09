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
  resolveExpertOriginHydrationView,
  shouldBlockExpertSurfaceForWorkspaceError,
} from "../src/react-app/domains/session/pages/expert-origin-hydration";
import {
  getSessionOriginRecoveryRetryDelayMs,
  resetSessionOriginHydrationForTests,
} from "../src/react-app/domains/agents/session-origin-hydration";

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
const appAgentsPath = new URL("../AGENTS.md", import.meta.url);

describe("experts/session invariants index", () => {
  test("apps/app AGENTS.md documents the five expert/session invariants", async () => {
    const agents = await readFile(appAgentsPath, "utf8");
    expect(agents).toContain("## Experts / Session 不变量");
    expect(agents).toContain("空壳禁止 startRun");
    expect(agents).toContain("Origin 水合权威");
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

describe("invariant 2: origin hydration is authoritative for empty landing", () => {
  test("workspace error blocks empty draft; hydration pending defers cold open", () => {
    expect(
      shouldBlockExpertSurfaceForWorkspaceError({
        selectedSessionId: null,
        showSelectedWorkspaceError: true,
      }),
    ).toBe(true);
    expect(
      resolveExpertOriginHydrationView({
        activeChat: true,
        originHydrated: false,
        originDegraded: false,
        hasAnyExpertConversation: false,
        showWorkspaceSetupEmptyState: false,
        showSelectedWorkspaceError: false,
        showBlockingStartupSkeleton: false,
        selectedSessionId: null,
      }),
    ).toMatchObject({
      deferColdOpen: true,
      showPendingWithoutSelection: true,
      showNoExpertConversation: false,
    });
    expect(
      resolveExpertOriginHydrationView({
        activeChat: true,
        originHydrated: true,
        originDegraded: true,
        hasAnyExpertConversation: false,
        showWorkspaceSetupEmptyState: false,
        showSelectedWorkspaceError: false,
        showBlockingStartupSkeleton: false,
        selectedSessionId: null,
      }),
    ).toMatchObject({
      showDegradedWithoutSelection: true,
      showNoExpertConversation: false,
    });
  });

  test("origin recovery retries are bounded (eventually null delay)", () => {
    resetSessionOriginHydrationForTests();
    const delays: Array<number | null> = [];
    for (let i = 0; i < 12; i += 1) {
      delays.push(getSessionOriginRecoveryRetryDelayMs(i));
    }
    expect(delays.some((d) => d === null)).toBe(true);
    expect(delays.filter((d) => typeof d === "number").length).toBeGreaterThan(0);
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
      contexts: { "order-entry": { conversationStartId: 101 } },
      draftAgentId: "order-entry",
      draftSessionActive: true,
      pendingAgent: {
        id: "order-entry",
        conversationStartId: 101,
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
    expect(source).toContain("Join marketplace install with env context prep");
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

  test("session loader origin recovery uses AbortController and authoritative merge", async () => {
    const source = await readFile(sessionLoaderPath, "utf8");
    expect(source).toContain("const originController = new AbortController()");
    expect(source).toContain("authoritativeItems");
    expect(source).toContain("mergeRecoveredSessionsWithCurrent");
  });
});
