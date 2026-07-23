import { describe, expect, test } from "bun:test";
import {
  buildIsolatedExpertSessionDirectory,
  createExpertSessionKey,
  formatExpertSessionStamp,
  formatExpertWorkspaceListLabel,
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

  test("creates readable name-date session keys for experts", () => {
    const stamp = formatExpertSessionStamp(new Date("2026-07-23T14:30:52"));
    expect(stamp).toBe("2026-07-23-143052");
    const key = createExpertSessionKey("物流单专家");
    expect(key.startsWith("物流单专家-")).toBe(true);
    expect(key).toMatch(/^物流单专家-\d{4}-\d{2}-\d{2}-\d{6}$/);
  });

  test("formats list labels for new and legacy expert folders", () => {
    expect(
      formatExpertWorkspaceListLabel(
        "/Users/me/Workspace/物流单专家/物流单专家-2026-07-23-143052",
      ),
    ).toBe("物流单专家 · 2026-07-23 14:30");
    expect(
      formatExpertWorkspaceListLabel(
        "/Users/me/Workspace/物流单专家/e4fae6588c5f",
      ),
    ).toBe("物流单专家 · e4fae6");
    expect(formatExpertWorkspaceListLabel("/Users/me/Projects/my-app")).toBe(
      "my-app",
    );
  });

  test("builds AgentName/sessionKey under the workspace root", () => {
    const isolated = buildIsolatedExpertSessionDirectory({
      workspaceRoot: "/Users/me/Workspace",
      agentName: "物流单专家",
      sessionKey: "物流单专家-2026-07-23-143052",
    });
    expect(isolated.directory).toBe(
      "/Users/me/Workspace/物流单专家/物流单专家-2026-07-23-143052",
    );
    expect(isolated.agentSegment).toBe("物流单专家");
    expect(isolated.markerRelativePath).toBe(
      "物流单专家/物流单专家-2026-07-23-143052/onmyagent-session.json",
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

  test("session file root follows the folder selected for the session", () => {
    expect(
      resolveSelectedSessionFileRoot({
        boundDirectory: "/Users/me/Work",
        sessionDirectory: "/Users/me/Work",
        workspaceRoot: "/Users/me/Work/",
      }),
    ).toBe("/Users/me/Work");
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
