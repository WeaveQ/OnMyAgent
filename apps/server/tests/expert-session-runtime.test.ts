import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceInfo } from "@onmyagent/types/server";

import {
  createExpertSessionRuntimeDirectory,
  ensureExpertSessionRuntimeIsolation,
  EXPERT_SESSION_ISOLATION_VERSION,
  resolveAuthorizedArtifactResolutionRoot,
  resolveAuthorizedExpertSessionRuntimeDirectory,
} from "../src/services/expert-session-runtime.js";
import { getExpertLifecycleEventsSnapshot, resetExpertLifecycleEventsForTest } from "../src/services/expert-lifecycle-events.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "onmyagent-expert-runtime-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
  resetExpertLifecycleEventsForTest();
});

describe("expert session runtime directory", () => {
  test("authorizes canonical workspace session roots without symlink escapes", async () => {
    const workspace = testWorkspace(join(tempRoot, "project"));
    const internalRoot = join(workspace.path, "sessions", "internal");
    const outsideRoot = join(tempRoot, "outside");
    const escapedRoot = join(workspace.path, "sessions", "escaped");
    await Promise.all([
      mkdir(internalRoot, { recursive: true }),
      mkdir(outsideRoot, { recursive: true }),
    ]);
    await symlink(outsideRoot, escapedRoot, "dir");

    await expect(resolveAuthorizedArtifactResolutionRoot({
      workspace,
      sessionRoot: workspace.path,
    })).resolves.toMatchObject({ root: workspace.path });
    await expect(resolveAuthorizedArtifactResolutionRoot({
      workspace,
      sessionRoot: internalRoot,
    })).resolves.toMatchObject({ root: internalRoot });
    await expect(resolveAuthorizedArtifactResolutionRoot({
      workspace,
      sessionRoot: escapedRoot,
    })).resolves.toBeNull();
    await expect(resolveAuthorizedArtifactResolutionRoot({
      workspace,
      sessionRoot: outsideRoot,
    })).resolves.toBeNull();
  });

  test("authorizes only the matching managed expert session directory", async () => {
    const runtimeRoot = join(tempRoot, "app-user-data", "expert-sessions");
    const validDirectory = join(runtimeRoot, "managed", "valid");
    const wrongWorkspaceDirectory = join(runtimeRoot, "managed", "wrong-workspace");
    const arbitraryDirectory = join(tempRoot, "arbitrary");
    const outsideDirectory = join(tempRoot, "outside");
    const escapedDirectory = join(runtimeRoot, "managed", "escaped");
    const symlinkedRuntimeRoot = join(tempRoot, "runtime-root-link");
    await Promise.all([
      mkdir(validDirectory, { recursive: true }),
      mkdir(wrongWorkspaceDirectory, { recursive: true }),
      mkdir(arbitraryDirectory, { recursive: true }),
      mkdir(outsideDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeMarker(validDirectory, "ws_test"),
      writeMarker(wrongWorkspaceDirectory, "ws_other"),
      writeMarker(outsideDirectory, "ws_test"),
    ]);
    await symlink(outsideDirectory, escapedDirectory, "dir");
    await symlink(runtimeRoot, symlinkedRuntimeRoot, "dir");

    await expect(resolveAuthorizedExpertSessionRuntimeDirectory({
      workspaceId: "ws_test",
      sessionRoot: validDirectory,
      runtimeRoot,
    })).resolves.toBe(validDirectory);
    await expect(resolveAuthorizedExpertSessionRuntimeDirectory({
      workspaceId: "ws_test",
      sessionRoot: wrongWorkspaceDirectory,
      runtimeRoot,
    })).resolves.toBeNull();
    await expect(resolveAuthorizedExpertSessionRuntimeDirectory({
      workspaceId: "ws_test",
      sessionRoot: join(symlinkedRuntimeRoot, "managed", "valid"),
      runtimeRoot: symlinkedRuntimeRoot,
    })).resolves.toBeNull();
    await expect(resolveAuthorizedExpertSessionRuntimeDirectory({
      workspaceId: "ws_test",
      sessionRoot: arbitraryDirectory,
      runtimeRoot,
    })).resolves.toBeNull();
    await expect(resolveAuthorizedExpertSessionRuntimeDirectory({
      workspaceId: "ws_test",
      sessionRoot: escapedDirectory,
      runtimeRoot,
    })).resolves.toBeNull();
  });

  test("creates the default session outside the workspace", async () => {
    const workspace = testWorkspace(join(tempRoot, "project"));
    const runtimeRoot = join(tempRoot, "app-user-data", "expert-sessions");
    await mkdir(workspace.path, { recursive: true });

    const result = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "高级开发工程师",
      agentId: "senior-developer",
      sessionKey: "1753456789000",
      approvedAgentIds: ["onmyagent", "custom-safe-agent"],
    });

    expect(result.directory.startsWith(runtimeRoot)).toBe(true);
    expect(result.directory.startsWith(workspace.path)).toBe(false);
    expect(await readFile(join(result.directory, "onmyagent-session.json"), "utf8"))
      .toContain('"runtime": true');
    expect(result.defaultAgent).toBe("onmyagent");
    // OpenCode has not returned a real session id yet; marker remains a
    // pending v2 identity and is upgraded after session.create.
    expect(result.isolationVersion).toBe(2);
    expect(result.packageName).toBe("senior-developer");
    expect(result.approvedAgentIds).toEqual(["onmyagent", "custom-safe-agent"]);
    expect(await readFile(join(result.directory, "onmyagent-session.json"), "utf8"))
      .toContain('"approvedAgentIds"');
    expect(result.sessionId).toBeUndefined();
    const opencode = JSON.parse(
      await readFile(join(result.directory, "opencode.json"), "utf8"),
    ) as { default_agent?: string; plugin?: unknown[] };
    expect(opencode.default_agent).toBe("onmyagent");
    expect(opencode.plugin).toEqual([]);
    const agentMd = await readFile(
      join(result.directory, ".opencode", "agents", "onmyagent.md"),
      "utf8",
    );
    expect(agentMd).toContain("mode: primary");
    expect(agentMd).toContain("expert session");
  });

  test("materializes only declared skills into the session skills root", async () => {
    const workspace = testWorkspace(join(tempRoot, "project"));
    const runtimeRoot = join(tempRoot, "app-user-data", "expert-sessions");
    const skillsSource = join(tempRoot, "skills-source");
    await mkdir(workspace.path, { recursive: true });
    await mkdir(join(skillsSource, "kol-script-risk-review"), { recursive: true });
    await mkdir(join(skillsSource, "unrelated-global-skill"), { recursive: true });
    await writeFile(join(skillsSource, "kol-script-risk-review", "SKILL.md"), "---\nname: kol-script-risk-review\n---\n# ok\n");
    await writeFile(join(skillsSource, "unrelated-global-skill", "SKILL.md"), "---\nname: unrelated-global-skill\n---\n# no\n");

    const result = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "达人运营专家",
      agentId: "kol-content-ops-specialist",
      sessionKey: "1753456789001",
      skillNames: ["kol-script-risk-review", "missing-skill", "../escape"],
      skillsSourceRoot: skillsSource,
    });

    expect(result.installedSkills).toEqual(["kol-script-risk-review"]);
    expect(getExpertLifecycleEventsSnapshot().events.some((event) =>
      event.kind === "materialize" && event.declaredSkillCount === 2 && event.missingSkillCount === 1,
    )).toBe(true);
    expect(getExpertLifecycleEventsSnapshot().events.some((event) => event.kind === "missing_skills")).toBe(true);
    expect(JSON.stringify(getExpertLifecycleEventsSnapshot())).not.toContain(result.directory);
    expect(
      await readFile(
        join(result.directory, ".opencode", "skills", "kol-script-risk-review", "SKILL.md"),
        "utf8",
      ),
    ).toContain("kol-script-risk-review");
    await expect(
      readFile(
        join(result.directory, ".opencode", "skills", "unrelated-global-skill", "SKILL.md"),
        "utf8",
      ),
    ).rejects.toThrow();
  });

  test("does not report stale marker skills as physically installed", async () => {
    const workspace = testWorkspace(join(tempRoot, "project-stale-skills"));
    const runtimeRoot = join(tempRoot, "app-user-data", "expert-sessions");
    const skillsSource = join(tempRoot, "skills-source-stale");
    await mkdir(workspace.path, { recursive: true });
    await mkdir(join(skillsSource, "declared-skill"), { recursive: true });
    await writeFile(
      join(skillsSource, "declared-skill", "SKILL.md"),
      "---\nname: declared-skill\n---\n# installed once\n",
    );
    const created = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "stale skill expert",
      agentId: "stale-skill-agent",
      packageName: "stale-skill-package",
      sessionKey: "1753456789011",
      skillNames: ["declared-skill"],
      skillsSourceRoot: skillsSource,
    });
    expect(created.installedSkills).toEqual(["declared-skill"]);
    await rm(join(created.directory, ".opencode", "skills", "declared-skill"), {
      recursive: true,
      force: true,
    });

    const ensured = await ensureExpertSessionRuntimeIsolation({
      workspace,
      directory: created.directory,
      runtimeRoot,
      skillNames: ["declared-skill"],
      skillsSourceRoot: join(tempRoot, "missing-skills-source"),
    });
    expect(ensured?.installedSkills).toEqual([]);
    expect(ensured?.missingSkills).toEqual(["declared-skill"]);
  });

  test("ensure upgrades a pre-isolation expert session directory", async () => {
    const workspace = testWorkspace(join(tempRoot, "project"));
    const runtimeRoot = join(tempRoot, "app-user-data", "expert-sessions");
    await mkdir(workspace.path, { recursive: true });
    const created = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "legacy",
      agentId: "legacy-id",
      sessionKey: "1753456789002",
    });
    // Simulate old marker without isolation + missing agent file.
    await writeFile(
      join(created.directory, "onmyagent-session.json"),
      JSON.stringify({
        kind: "expert-session",
        workspaceId: "ws_test",
        agent: created.agentSegment,
        sessionKey: created.sessionKey,
        runtime: true,
      }),
      "utf8",
    );
    await rm(join(created.directory, ".opencode", "agents", "onmyagent.md"), {
      force: true,
    });

    const ensured = await ensureExpertSessionRuntimeIsolation({
      workspace,
      directory: created.directory,
      runtimeRoot,
    });
    expect(ensured?.upgraded).toBe(true);
    expect(ensured?.isolationVersion).toBe(2);
    expect(ensured?.sessionId).toBeUndefined();
    expect(
      await readFile(
        join(created.directory, ".opencode", "agents", "onmyagent.md"),
        "utf8",
      ),
    ).toContain("mode: primary");

    const again = await ensureExpertSessionRuntimeIsolation({
      workspace,
      directory: created.directory,
      runtimeRoot,
    });
    expect(again?.upgraded).toBe(false);
  });

  test("upgrades pending marker to v3 only with an explicit session identity", async () => {
    const workspace = testWorkspace(join(tempRoot, "project-v3"));
    const runtimeRoot = join(tempRoot, "app-user-data", "expert-sessions");
    await mkdir(workspace.path, { recursive: true });
    const created = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "runtime expert",
      agentId: "agent-v3",
      packageName: "package-v3",
      sessionKey: "1753456789010",
      skillNames: ["missing-skill"],
    });
    const pending = JSON.parse(await readFile(join(created.directory, "onmyagent-session.json"))) as Record<string, unknown>;
    expect(pending.isolationVersion).toBe(2);
    expect(pending.sessionId).toBeUndefined();

    const upgraded = await ensureExpertSessionRuntimeIsolation({
      workspace,
      directory: created.directory,
      runtimeRoot,
      agentId: "agent-v3",
      packageName: "package-v3",
      sessionId: "session-v3",
      skillNames: ["missing-skill"],
    });
    expect(upgraded).toMatchObject({
      upgraded: true,
      isolationVersion: EXPERT_SESSION_ISOLATION_VERSION,
      agentId: "agent-v3",
      packageName: "package-v3",
      sessionId: "session-v3",
      declaredSkills: ["missing-skill"],
      installedSkills: [],
      missingSkills: ["missing-skill"],
    });
    const marker = JSON.parse(await readFile(join(created.directory, "onmyagent-session.json"))) as Record<string, unknown>;
    expect(marker).toMatchObject({
      isolationVersion: 3,
      agentId: "agent-v3",
      packageName: "package-v3",
      sessionId: "session-v3",
      declaredSkills: ["missing-skill"],
      installedSkills: [],
      missingSkills: ["missing-skill"],
    });
  });

  test("rejects malformed v3 markers instead of authorizing their directory", async () => {
    const workspace = testWorkspace(join(tempRoot, "project-invalid-v3"));
    const runtimeRoot = join(tempRoot, "app-user-data", "expert-sessions");
    const directory = join(runtimeRoot, "managed", "invalid");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "onmyagent-session.json"), JSON.stringify({
      kind: "expert-session",
      workspaceId: workspace.id,
      isolationVersion: 3,
      agentId: "agent-invalid",
      packageName: "package-invalid",
      sessionId: "session-invalid",
      declaredSkills: ["valid-skill"],
      installedSkills: ["valid-skill"],
      missingSkills: ["valid-skill"],
    }), "utf8");
    await expect(resolveAuthorizedExpertSessionRuntimeDirectory({
      workspaceId: workspace.id,
      sessionRoot: directory,
      runtimeRoot,
    })).resolves.toBeNull();
  });

  test("rejects a runtime root inside the workspace", async () => {
    const workspace = testWorkspace(join(tempRoot, "project"));
    await mkdir(workspace.path, { recursive: true });
    await expect(createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot: join(workspace.path, "experts"),
      agentName: "expert",
    })).rejects.toThrow("must be outside the workspace");
  });
});

function testWorkspace(path: string): WorkspaceInfo {
  return {
    id: "ws_test",
    name: "Test",
    path,
    preset: "default",
    workspaceType: "local",
  };
}

async function writeMarker(directory: string, workspaceId: string) {
  await writeFile(
    join(directory, "onmyagent-session.json"),
    JSON.stringify({ kind: "expert-session", workspaceId }),
    "utf8",
  );
}

describe("resolveExpertAgentSegment", () => {
  test("uses package token only for marketplace ids", async () => {
    const { resolveExpertAgentSegment } = await import(
      "../src/services/expert-session-runtime.js"
    );
    expect(
      resolveExpertAgentSegment(
        "项目复盘专家",
        "kol-project-review-specialist:kol-project-review-specialist",
      ),
    ).toBe("kol-project-review-specialist");
    expect(resolveExpertAgentSegment("Media Specialist", "kol-media-specialist")).toBe(
      "kol-media-specialist",
    );
    expect(resolveExpertAgentSegment("Custom Expert", "")).toBe("Custom-Expert");
  });

  test("createExpertSessionRuntimeDirectory does not double package slug", async () => {
    const runtimeRoot = join(tempRoot, "runtime");
    const workspace = testWorkspace(join(tempRoot, "project-create"));
    await mkdir(workspace.path, { recursive: true });
    const result = await createExpertSessionRuntimeDirectory({
      workspace,
      agentName: "项目复盘专家",
      agentId: "kol-project-review-specialist:kol-project-review-specialist",
      sessionKey: "1786347548004",
      runtimeRoot,
    });
    expect(result.agentSegment).toBe("kol-project-review-specialist");
    expect(result.directory.endsWith("/kol-project-review-specialist/1786347548004")).toBe(
      true,
    );
    expect(result.directory.includes("kol-project-review-specialistkol")).toBe(false);
    const marker = JSON.parse(
      await readFile(join(result.directory, "onmyagent-session.json"), "utf8"),
    );
    expect(marker.agent).toBe("kol-project-review-specialist");
  });
});
