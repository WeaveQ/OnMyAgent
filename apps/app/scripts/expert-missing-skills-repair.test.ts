import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ExpertDirectoryRecord } from "@onmyagent/types/server";

import {
  dismissExpertMissingSkillsNotice,
  isExpertMissingSkillsNoticeDismissed,
  missingSkillsFingerprint,
  packageNameForExpertRepair,
  repairExpertMissingSkills,
  selectExpertDirectoryRecord,
  selectExpertMissingSkillRepairTargets,
} from "../src/react-app/domains/session/pages/expert-missing-skills-repair";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial));
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function record(
  input: Partial<ExpertDirectoryRecord> & Pick<ExpertDirectoryRecord, "agentId">,
): ExpertDirectoryRecord {
  return {
    packageName: input.packageName ?? "pkg",
    sessionIds: input.sessionIds ?? [],
    runtimeDirectories: input.runtimeDirectories ?? [],
    sessions: input.sessions ?? [],
    runtimeMissing: input.runtimeMissing ?? false,
    declaredSkills: input.declaredSkills ?? [],
    installedSkills: input.installedSkills ?? [],
    missingSkills: input.missingSkills ?? [],
    ...input,
  };
}

describe("missing-skills notice dismiss", () => {
  test("fingerprints workspace, agent, and sorted unique skills", () => {
    expect(
      missingSkillsFingerprint(" ws ", " agent ", ["b", "a", "a", ""]),
    ).toBe("ws\0agent\0a,b");
  });

  test("persists dismiss only for the same workspace/agent/skills set", () => {
    const storage = memoryStorage();
    const base = {
      workspaceId: "ws",
      agentId: "review",
      skills: ["kol-review-report-audit", "kol-project-review-framework"],
      storage,
    };
    expect(isExpertMissingSkillsNoticeDismissed(base)).toBe(false);
    dismissExpertMissingSkillsNotice(base);
    expect(isExpertMissingSkillsNoticeDismissed(base)).toBe(true);
    expect(
      isExpertMissingSkillsNoticeDismissed({
        ...base,
        skills: ["kol-review-report-audit"],
      }),
    ).toBe(false);
    expect(
      isExpertMissingSkillsNoticeDismissed({
        ...base,
        agentId: "media",
      }),
    ).toBe(false);
  });
});

describe("selectExpertMissingSkillRepairTargets", () => {
  test("repairs only sessions that still miss skills", () => {
    expect(
      selectExpertMissingSkillRepairTargets(
        record({
          agentId: "review",
          sessions: [
            {
              sessionId: "ok",
              directory: "/tmp/ok",
              runtimeMissing: false,
              declaredSkills: ["a"],
              installedSkills: ["a"],
              missingSkills: [],
            },
            {
              sessionId: "broken",
              directory: "/tmp/broken",
              runtimeMissing: false,
              declaredSkills: ["a", "b"],
              installedSkills: [],
              missingSkills: ["a", "b"],
            },
          ],
        }),
      ),
    ).toEqual([{ sessionId: "broken", directory: "/tmp/broken" }]);
  });

  test("falls back to runtime directories when session rows have no path", () => {
    expect(
      selectExpertMissingSkillRepairTargets(
        record({
          agentId: "review",
          runtimeDirectories: ["/tmp/runtime"],
          sessions: [
            {
              sessionId: "ses",
              runtimeMissing: false,
              declaredSkills: ["a"],
              installedSkills: [],
              missingSkills: ["a"],
            },
          ],
        }),
      ),
    ).toEqual([{ sessionId: "ses", directory: "/tmp/runtime" }]);
  });
});

describe("packageNameForExpertRepair", () => {
  test("prefers the package field, then the agent id prefix", () => {
    expect(packageNameForExpertRepair("pkg:pkg", " from-field ")).toBe("from-field");
    expect(
      packageNameForExpertRepair("kol-project-review-specialist:kol-project-review-specialist"),
    ).toBe("kol-project-review-specialist");
    expect(packageNameForExpertRepair("custom-expert")).toBe("custom-expert");
  });
});

describe("repairExpertMissingSkills", () => {
  test("ensures isolation with package name and declared skills, then reports remaining", async () => {
    const calls: Array<{ directory: string; packageName?: string; skillNames?: string[] }> = [];
    const result = await repairExpertMissingSkills({
      workspaceId: "ws",
      agentId: "kol-project-review-specialist:kol-project-review-specialist",
      record: record({
        agentId: "kol-project-review-specialist:kol-project-review-specialist",
        packageName: "kol-project-review-specialist",
        declaredSkills: ["kol-review-report-audit", "kol-project-review-framework"],
        missingSkills: ["kol-review-report-audit"],
        sessions: [
          {
            sessionId: "ses-review",
            directory: "/tmp/review",
            runtimeMissing: false,
            declaredSkills: ["kol-review-report-audit", "kol-project-review-framework"],
            installedSkills: [],
            missingSkills: ["kol-review-report-audit"],
          },
        ],
      }),
      client: {
        async ensureExpertSessionIsolation(_workspaceId, payload) {
          calls.push({
            directory: payload.directory,
            packageName: payload.packageName,
            skillNames: payload.skillNames,
          });
          return { missingSkills: [] };
        },
        async getExpertDirectory() {
          return {
            records: [
              record({
                agentId: "kol-project-review-specialist:kol-project-review-specialist",
                missingSkills: [],
              }),
            ],
          };
        },
      },
    });
    expect(calls).toEqual([
      {
        directory: "/tmp/review",
        packageName: "kol-project-review-specialist",
        skillNames: ["kol-project-review-framework", "kol-review-report-audit"],
      },
    ]);
    expect(result.remaining).toEqual([]);
  });

  test("loads the directory when no record was passed in", async () => {
    const calls: string[] = [];
    const result = await repairExpertMissingSkills({
      workspaceId: "ws",
      agentId: "review",
      client: {
        async ensureExpertSessionIsolation(_workspaceId, payload) {
          calls.push(payload.directory);
          return { missingSkills: [] };
        },
        async getExpertDirectory() {
          return {
            records: [
              record({
                agentId: "review",
                packageName: "review-pkg",
                declaredSkills: ["skill-a"],
                missingSkills: calls.length === 0 ? ["skill-a"] : [],
                sessions: [
                  {
                    sessionId: "ses",
                    directory: "/tmp/ses",
                    runtimeMissing: false,
                    declaredSkills: ["skill-a"],
                    installedSkills: [],
                    missingSkills: calls.length === 0 ? ["skill-a"] : [],
                  },
                ],
              }),
            ],
          };
        },
      },
    });
    expect(calls).toEqual(["/tmp/ses"]);
    expect(result.remaining).toEqual([]);
  });

  test("does not isolate another expert's sessions", async () => {
    const result = await repairExpertMissingSkills({
      workspaceId: "ws",
      agentId: "media",
      client: {
        async ensureExpertSessionIsolation() {
          throw new Error("should not isolate");
        },
        async getExpertDirectory() {
          return {
            records: [
              record({
                agentId: "review",
                missingSkills: ["review-only"],
                sessions: [
                  {
                    sessionId: "ses-review",
                    directory: "/tmp/review",
                    runtimeMissing: false,
                    declaredSkills: ["review-only"],
                    installedSkills: [],
                    missingSkills: ["review-only"],
                  },
                ],
              }),
            ],
          };
        },
      },
    });
    expect(result.remaining).toEqual([]);
    expect(selectExpertDirectoryRecord(
      [{ agentId: "review" }, { agentId: "media" }],
      "media",
    )?.agentId).toBe("media");
  });
});

describe("expert page does not surface missing-skills UI", () => {
  test("layout no longer mounts the repair toast or sticky banner", () => {
    const layout = readFileSync(
      join(import.meta.dir, "../src/react-app/domains/session/pages/expert-page-layout.tsx"),
      "utf8",
    );
    expect(layout).not.toContain("useExpertMissingSkillsNotice");
    expect(layout).not.toContain("ExpertDirectoryMissingSkillsNotice");
  });
});
