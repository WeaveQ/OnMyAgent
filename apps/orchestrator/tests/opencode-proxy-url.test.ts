import { describe, expect, test } from "bun:test";

import { workspaceIdForPath } from "../../server/src/workspace/workspaces.ts";
import {
  onmyagentOpencodeProxyBaseUrl,
  onmyagentServerWorkspaceIdForPath,
} from "../src/cli-shared.ts";
import { SANDBOX_WORKSPACE_DIR } from "../src/sandbox-constants.ts";

describe("sandbox OpenCode proxy URL", () => {
  test("uses the server workspace id, not the orchestrator local hash", () => {
    const workspacePath = "/tmp/onmyagent-workspace";
    expect(onmyagentServerWorkspaceIdForPath(workspacePath)).toBe(
      workspaceIdForPath(workspacePath),
    );
    expect(onmyagentServerWorkspaceIdForPath(workspacePath)).not.toMatch(/^ws-/);
    expect(
      onmyagentOpencodeProxyBaseUrl("http://127.0.0.1:8787/", workspacePath),
    ).toBe(
      `http://127.0.0.1:8787/workspace/${workspaceIdForPath(workspacePath)}/opencode`,
    );
  });

  test("sandbox attach URL hashes the container workspace path", () => {
    expect(SANDBOX_WORKSPACE_DIR).toBe("/workspace");
    expect(
      onmyagentOpencodeProxyBaseUrl("http://127.0.0.1:8787", SANDBOX_WORKSPACE_DIR),
    ).toBe(
      `http://127.0.0.1:8787/workspace/${workspaceIdForPath("/workspace")}/opencode`,
    );
  });
});
