import { describe, expect, test } from "bun:test";
import type { ExpertDirectoryProjection } from "@onmyagent/types/server";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildExpertDirectoryPageModel } from "../src/react-app/capabilities/session-identity/expert-directory-page-model";
import {
  expertDirectoryQuerySnapshotForPaint,
  scheduleAfterFirstPaint,
  shouldEnableExpertDirectoryNetwork,
} from "../src/react-app/capabilities/session-identity/expert-directory-query";
import {
  expertPackageMarketplacesForEnter,
  fetchExpertPackageEntries,
} from "../src/react-app/domains/agents/expert-package-query";
import {
  buildExpertPageIdentityModel,
  collectExpertMissingSkills,
  isExpertDirectoryReadyForIdentity,
} from "../src/react-app/domains/session/pages/expert-page-identity-model";

describe("collectExpertMissingSkills", () => {
  const records = [
    {
      agentId: "fleet-management-specialist:fleet-management-specialist",
      missingSkills: ["fleet-data-consolidation", "vehicle-candidate-ranking"],
    },
    {
      agentId: "proposal-strategist:proposal-strategist",
      missingSkills: ["anti-distill", "market-researcher", "marketing-skills"],
    },
  ];

  test("scopes missing skills to the active expert agent", () => {
    expect(
      collectExpertMissingSkills(
        records,
        "fleet-management-specialist:fleet-management-specialist",
      ),
    ).toEqual(["fleet-data-consolidation", "vehicle-candidate-ranking"]);
  });

  test("falls back to the directory union when no agent is selected", () => {
    expect(collectExpertMissingSkills(records, null)).toEqual([
      "anti-distill",
      "fleet-data-consolidation",
      "market-researcher",
      "marketing-skills",
      "vehicle-candidate-ranking",
    ]);
  });

  test("tolerates missing missingSkills arrays without throwing", () => {
    expect(
      collectExpertMissingSkills(
        [
          { agentId: "a", missingSkills: null },
          { agentId: "b" },
          { agentId: "c", missingSkills: ["ok"] },
        ] as Array<{ agentId: string; missingSkills?: readonly string[] | null }>,
        null,
      ),
    ).toEqual(["ok"]);
  });
});

function directoryProjection(
  input: Partial<ExpertDirectoryProjection> = {},
): ExpertDirectoryProjection {
  return {
    version: 1,
    schema: "onmyagent.expert-directory.v1",
    revision: 1,
    complete: true,
    state: "ok",
    failures: [],
    inventoryFingerprint: "fingerprint-1",
    records: [{
      agentId: "agent-a",
      packageName: "package-a",
      sessionIds: ["session-a"],
      runtimeDirectories: [],
      sessions: [{ sessionId: "session-a", runtimeMissing: false, declaredSkills: [], installedSkills: [], missingSkills: [] }],
      runtimeMissing: false,
      declaredSkills: [],
      installedSkills: [],
      missingSkills: [],
    }],
    tombstonedSessionIds: [],
    ...input,
  };
}

describe("stale lastComplete is not live ready identity", () => {
  test("incomplete newer projection without session-a is not ready from lastComplete", () => {
    const lastComplete = directoryProjection({ revision: 5 });
    const incoming = directoryProjection({
      revision: 6,
      complete: false,
      records: [],
      tombstonedSessionIds: ["session-a"],
    });
    const directoryPage = buildExpertDirectoryPageModel({
      query: { data: incoming, lastComplete },
    });
    const identity = buildExpertPageIdentityModel({
      directoryPage,
      workspaceSessions: [],
      registry: null,
      selectedSessionId: "session-a",
      directoryQuery: { data: incoming, lastComplete },
    });
    expect(identity.expertDirectoryIdentity.sessionIds.has("session-a")).toBe(false);
    expect(identity.expertDirectoryReady).toBe(false);
    expect(isExpertDirectoryReadyForIdentity({
      state: directoryPage.state,
      payload: directoryPage.payload,
      data: incoming,
      lastComplete,
    })).toBe(false);
  });

  test("error with newer data missing session-a is not ready from lastComplete", () => {
    const lastComplete = directoryProjection({ revision: 5 });
    const incoming = directoryProjection({
      revision: 6,
      complete: false,
      records: [],
      tombstonedSessionIds: ["session-a"],
    });
    const directoryPage = buildExpertDirectoryPageModel({
      query: { data: incoming, lastComplete, error: new Error("session_lookup_failed") },
    });
    const identity = buildExpertPageIdentityModel({
      directoryPage,
      workspaceSessions: [],
      registry: null,
      selectedSessionId: "session-a",
      directoryQuery: { data: incoming, lastComplete },
    });
    expect(identity.expertDirectoryIdentity.sessionIds.has("session-a")).toBe(false);
    expect(identity.expertDirectoryReady).toBe(false);
  });

  test("incomplete live records stay ready enough without resurrecting deleted ids", () => {
    const lastComplete = directoryProjection({ revision: 5 });
    const incoming = directoryProjection({
      revision: 6,
      complete: false,
      records: [{
        agentId: "agent-b",
        packageName: "package-b",
        sessionIds: ["session-b"],
        runtimeDirectories: [],
        sessions: [{ sessionId: "session-b", runtimeMissing: false, declaredSkills: [], installedSkills: [], missingSkills: [] }],
        runtimeMissing: false,
        declaredSkills: [],
        installedSkills: [],
        missingSkills: [],
      }],
      tombstonedSessionIds: ["session-a"],
    });
    const directoryPage = buildExpertDirectoryPageModel({
      query: { data: incoming, lastComplete },
    });
    const identity = buildExpertPageIdentityModel({
      directoryPage,
      workspaceSessions: [],
      registry: null,
      selectedSessionId: "session-a",
      directoryQuery: { data: incoming, lastComplete },
    });
    expect(identity.expertDirectoryIdentity.sessionIds.has("session-a")).toBe(false);
    expect(identity.expertDirectoryIdentity.sessionIds.has("session-b")).toBe(true);
    expect(identity.expertDirectoryReady).toBe(true);
  });

  test("pending lastComplete without newer data remains ready enough", () => {
    const lastComplete = directoryProjection({ revision: 5 });
    const directoryPage = buildExpertDirectoryPageModel({
      query: { isPending: true, lastComplete },
    });
    const identity = buildExpertPageIdentityModel({
      directoryPage,
      workspaceSessions: [],
      registry: null,
      selectedSessionId: "session-a",
      directoryQuery: { lastComplete },
    });
    expect(identity.expertDirectoryReady).toBe(true);
    expect(identity.expertDirectoryIdentity.sessionIds.has("session-a")).toBe(true);
  });
});

describe("expert first-paint Directory + package listing", () => {
  test("Directory network stays off until after first paint", () => {
    expect(shouldEnableExpertDirectoryNetwork({ afterFirstPaint: false })).toBe(
      false,
    );
    expect(shouldEnableExpertDirectoryNetwork({ afterFirstPaint: true })).toBe(
      true,
    );

    let ran = false;
    const queued: Array<() => void> = [];
    const cancel = scheduleAfterFirstPaint(() => {
      ran = true;
    }, {
      setTimeout: (handler) => {
        queued.push(handler);
        return 1;
      },
      clearTimeout: () => undefined,
    });
    expect(ran).toBe(false);
    queued[0]?.();
    expect(ran).toBe(true);
    cancel();
  });

  test("deferred Directory snapshot does not paint as loading", () => {
    const pending = expertDirectoryQuerySnapshotForPaint({
      afterFirstPaint: false,
      isPending: true,
      isLoading: true,
    });
    expect(pending.networkEnabled).toBe(false);
    expect(pending.isPending).toBe(false);
    expect(pending.isLoading).toBe(false);
    expect(buildExpertDirectoryPageModel({ query: pending }).state).toBe(
      "incomplete",
    );

    const cached = directoryProjection({ revision: 3 });
    const cachedPaint = expertDirectoryQuerySnapshotForPaint({
      afterFirstPaint: false,
      isPending: true,
      isLoading: true,
      lastComplete: cached,
    });
    const cachedPage = buildExpertDirectoryPageModel({ query: cachedPaint });
    expect(cachedPage.state).toBe("ready");
    expect(cachedPage.payload?.revision).toBe(3);

    const live = expertDirectoryQuerySnapshotForPaint({
      afterFirstPaint: true,
      isPending: true,
      isLoading: true,
    });
    expect(live.networkEnabled).toBe(true);
    expect(buildExpertDirectoryPageModel({ query: live }).state).toBe("loading");
  });

  test("chat enter lists only my-experts; store and expert page list both", async () => {
    expect(expertPackageMarketplacesForEnter("chat")).toEqual(["my-experts"]);
    expect(expertPackageMarketplacesForEnter("store")).toEqual([
      "experts",
      "my-experts",
    ]);
    expect(expertPackageMarketplacesForEnter("expert-page")).toEqual([
      "experts",
      "my-experts",
    ]);

    const seen: string[] = [];
    await fetchExpertPackageEntries(
      expertPackageMarketplacesForEnter("store"),
      async (marketplace) => {
        seen.push(marketplace);
        return [];
      },
    );
    expect(seen).toEqual(["experts", "my-experts"]);

    const identity = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/pages/use-expert-page-identity.ts",
      ),
      "utf8",
    );
    expect(identity).toContain("shouldEnableExpertDirectoryNetwork");
    expect(identity).toContain("expertDirectoryQuerySnapshotForPaint");
    expect(identity).toContain("scheduleAfterFirstPaint");

    const chatPackages = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/pages/use-my-expert-packages.ts",
      ),
      "utf8",
    );
    expect(chatPackages).toContain('expertPackageMarketplacesForEnter("store")');
  });
});
