import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceInfo } from "@onmyagent/types/server";

import {
  createExpertSessionRuntimeDirectory,
  resolveAuthorizedArtifactResolutionRoot,
  resolveAuthorizedExpertSessionRuntimeDirectory,
} from "../src/services/expert-session-runtime.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "onmyagent-expert-runtime-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
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
    });

    expect(result.directory.startsWith(runtimeRoot)).toBe(true);
    expect(result.directory.startsWith(workspace.path)).toBe(false);
    expect(await readFile(join(result.directory, "onmyagent-session.json"), "utf8"))
      .toContain('"runtime": true');
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
