import { describe, expect, test } from "bun:test";
import type { ExpertDirectoryProjection } from "@onmyagent/types/server";

import { buildExpertDirectoryPageModel } from "../src/react-app/capabilities/session-identity/expert-directory-page-model";
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
