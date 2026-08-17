import { describe, expect, test } from "bun:test";
import {
  buildIsolatedExpertSessionDirectory,
  createIsolatedExpertSessionRuntimeDirectory,
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

  test("builds experts/AgentName-agentId/sessionKey under the workspace root", () => {
    const isolated = buildIsolatedExpertSessionDirectory({
      workspaceRoot: "/Users/me/Workspace",
      agentName: "物流单专家",
      agentId: "order-entry-clerk",
      sessionKey: "1753456789000",
    });
    expect(isolated.directory).toBe(
      "/Users/me/Workspace/experts/物流单专家-order-entry-clerk/1753456789000",
    );
    expect(isolated.agentSegment).toBe("物流单专家-order-entry-clerk");
    expect(isolated.markerRelativePath).toBe(
      "experts/物流单专家-order-entry-clerk/1753456789000/onmyagent-session.json",
    );
    expect(isolated.markerContent).toContain("expert-session");
  });

  test("builds AgentName-only segment when agentId is missing", () => {
    const isolated = buildIsolatedExpertSessionDirectory({
      workspaceRoot: "/Users/me/Workspace",
      agentName: "油费稽核员",
      sessionKey: "1753456789000",
    });
    expect(isolated.agentSegment).toBe("油费稽核员");
    expect(isolated.directory).toBe(
      "/Users/me/Workspace/experts/油费稽核员/1753456789000",
    );
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

  test("session file root prefers session record directory over localStorage binding", () => {
    // Both equal -> returns the directory.
    expect(
      resolveSelectedSessionFileRoot({
        boundDirectory: "/Users/me/Work",
        sessionDirectory: "/Users/me/Work",
        workspaceRoot: "/Users/me/Work/",
      }),
    ).toBe("/Users/me/Work");
    // Real project subfolder on the session record still wins.
    expect(
      resolveSelectedSessionFileRoot({
        boundDirectory: "/Users/me/Work/物流单专家/abc",
        sessionDirectory: "/Users/me/Work/orders",
        workspaceRoot: "/Users/me/Work",
      }),
    ).toBe("/Users/me/Work/orders");
    // No session directory -> falls back to boundDirectory (legacy sessions).
    expect(
      resolveSelectedSessionFileRoot({
        boundDirectory: "/Users/me/Work/物流单专家/abc",
        sessionDirectory: null,
        workspaceRoot: "/Users/me/Work",
      }),
    ).toBe("/Users/me/Work/物流单专家/abc");
    // No session directory, no binding -> empty.
    expect(
      resolveSelectedSessionFileRoot({
        boundDirectory: null,
        sessionDirectory: null,
        workspaceRoot: "/Users/me/Work",
      }),
    ).toBe("");
  });

  test("space-bound chats use the user folder when session.directory is catalog or isolated", () => {
    expect(
      resolveSelectedSessionFileRoot({
        boundDirectory: "C:\\Users\\me\\OneDrive\\Desktop\\work",
        sessionDirectory: "C:\\Users\\me\\OnMyAgent\\catalog",
        workspaceRoot: "C:\\Users\\me\\OnMyAgent\\catalog",
      }),
    ).toBe("C:\\Users\\me\\OneDrive\\Desktop\\work");
    expect(
      resolveSelectedSessionFileRoot({
        boundDirectory: "/Users/me/Desktop/work",
        sessionDirectory: "/Users/me/Library/Application Support/OnMyAgent/expert-sessions/ws/agent/1753456789000",
        workspaceRoot: "/Users/me/Projects/app",
      }),
    ).toBe("/Users/me/Desktop/work");
    expect(
      resolveSelectedSessionFileRoot({
        boundDirectory: "/Users/me/Library/Application Support/OnMyAgent/expert-sessions/ws/agent/1753456789000",
        sessionDirectory: "/Users/me/Library/Application Support/OnMyAgent/expert-sessions/ws/agent/1753456789000",
        workspaceRoot: "/Users/me/Projects/app",
      }),
    ).toBe("/Users/me/Library/Application Support/OnMyAgent/expert-sessions/ws/agent/1753456789000");
  });

  test("accepts a server-created runtime directory outside the workspace", async () => {
    const result = await createIsolatedExpertSessionRuntimeDirectory({
      client: {
        createExpertSessionRuntimeDirectory: async () => ({
          directory: "/Users/me/Library/Application Support/OnMyAgent/expert-sessions/ws/expert/1",
          sessionKey: "1753456789000",
          agentSegment: "expert",
        }),
      },
      workspaceId: "ws_test",
      workspaceRoot: "/Users/me/Workspace",
      agentName: "expert",
    });
    expect(result?.directory).toContain("Application Support/OnMyAgent/expert-sessions");
  });

  test("rejects a server response that places runtime state inside the workspace", async () => {
    const result = await createIsolatedExpertSessionRuntimeDirectory({
      client: {
        createExpertSessionRuntimeDirectory: async () => ({
          directory: "/Users/me/Workspace/experts/expert/1753456789000",
          sessionKey: "1753456789000",
          agentSegment: "expert",
        }),
      },
      workspaceId: "ws_test",
      workspaceRoot: "/Users/me/Workspace",
      agentName: "expert",
    });
    expect(result).toBeNull();
  });
});
