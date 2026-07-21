import { describe, expect, test } from "bun:test";
import {
  buildIsolatedExpertSessionDirectory,
  isSameDirectory,
  joinWorkspacePath,
  sanitizePathSegment,
} from "../src/react-app/capabilities/session-identity/expert-session-directory";

describe("expert session directory isolation", () => {
  test("sanitizes agent names for path segments", () => {
    expect(sanitizePathSegment("物流单专家")).toBe("物流单专家");
    expect(sanitizePathSegment("a/b\\c:d")).toBe("a-b-cd");
    expect(sanitizePathSegment("...")).toBe("expert");
  });

  test("builds AgentName/sessionKey under the workspace root", () => {
    const isolated = buildIsolatedExpertSessionDirectory({
      workspaceRoot: "/Users/me/Workspace",
      agentName: "物流单专家",
      sessionKey: "abc123def456",
    });
    expect(isolated.directory).toBe("/Users/me/Workspace/物流单专家/abc123def456");
    expect(isolated.markerRelativePath).toBe("物流单专家/abc123def456/README.md");
    expect(isolated.agentSegment).toBe("物流单专家");
  });

  test("joins windows-style roots with backslash", () => {
    expect(joinWorkspacePath("C:\\Work\\Proj", "Agent", "sid")).toBe(
      "C:\\Work\\Proj\\Agent\\sid",
    );
  });

  test("compares directories case-insensitively and ignores trailing separators", () => {
    expect(isSameDirectory("/tmp/Work/", "/tmp/work")).toBe(true);
    expect(isSameDirectory("/tmp/a", "/tmp/b")).toBe(false);
  });
});
