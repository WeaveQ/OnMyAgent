import { describe, expect, test } from "bun:test";
import {
  buildIsolatedExpertSessionDirectory,
  isSameDirectory,
  joinWorkspacePath,
  resolveExpertSessionDirectoryMarker,
  resolveSelectedSessionFileRoot,
  sanitizePathSegment,
  shouldIsolateExpertSessionDirectory,
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
    expect(isolated.agentSegment).toBe("物流单专家");
    expect(isolated.markerRelativePath).toBe(
      "物流单专家/abc123def456/onmyagent-session.json",
    );
    expect(isolated.markerContent).toContain("expert-session");
  });

  test("resolves marker payload for an existing absolute session directory", () => {
    const marker = resolveExpertSessionDirectoryMarker(
      "/Users/me/Workspace",
      "/Users/me/Workspace/物流单录入作业/bca2a4a7fdbd",
    );
    expect(marker?.markerRelativePath).toBe(
      "物流单录入作业/bca2a4a7fdbd/onmyagent-session.json",
    );
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

  test("isolates when draft is empty or equal to the workspace root", () => {
    expect(shouldIsolateExpertSessionDirectory("/Users/me/Work", "")).toBe(true);
    expect(shouldIsolateExpertSessionDirectory("/Users/me/Work", null)).toBe(true);
    expect(
      shouldIsolateExpertSessionDirectory("/Users/me/Work", "/Users/me/Work/"),
    ).toBe(true);
    expect(
      shouldIsolateExpertSessionDirectory("/Users/me/Work", "/Users/me/Work/orders"),
    ).toBe(false);
    expect(shouldIsolateExpertSessionDirectory("", "/tmp/x")).toBe(false);
  });

  test("session file root never exposes the whole workspace tree", () => {
    expect(
      resolveSelectedSessionFileRoot({
        boundDirectory: "/Users/me/Work",
        sessionDirectory: "/Users/me/Work",
        workspaceRoot: "/Users/me/Work/",
      }),
    ).toBe("");
    expect(
      resolveSelectedSessionFileRoot({
        boundDirectory: "/Users/me/Work/物流单专家/abc",
        sessionDirectory: "/Users/me/Work",
        workspaceRoot: "/Users/me/Work",
      }),
    ).toBe("/Users/me/Work/物流单专家/abc");
    expect(
      resolveSelectedSessionFileRoot({
        boundDirectory: "",
        sessionDirectory: "/Users/me/Work/sub",
        workspaceRoot: "/Users/me/Work",
      }),
    ).toBe("/Users/me/Work/sub");
    expect(
      resolveSelectedSessionFileRoot({
        boundDirectory: null,
        sessionDirectory: null,
        workspaceRoot: "/Users/me/Work",
      }),
    ).toBe("");
  });
});
