import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceInfo } from "@onmyagent/types/server";

import { createExpertSessionRuntimeDirectory } from "../src/services/expert-session-runtime.js";

let tempRoot = "";

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "onmyagent-expert-runtime-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("expert session runtime directory", () => {
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
