import { describe, expect, test } from "bun:test";
import { resolveToolWorkspaceFileRoot } from "../src/react-app/domains/workspace/workspace-files-page";

describe("resolveToolWorkspaceFileRoot", () => {
  test("prefers draft tool folder over session and workspace", () => {
    expect(
      resolveToolWorkspaceFileRoot({
        draftWorkspaceDirectory: "/Users/me/tool-space",
        sessionFileRoot: "/Users/me/ws/session-a",
        workspaceRoot: "/Users/me/ws",
      }),
    ).toBe("/Users/me/tool-space");
  });

  test("uses session file root when draft is empty", () => {
    expect(
      resolveToolWorkspaceFileRoot({
        draftWorkspaceDirectory: "  ",
        sessionFileRoot: "/Users/me/ws/session-a",
        workspaceRoot: "/Users/me/ws",
      }),
    ).toBe("/Users/me/ws/session-a");
  });

  test("falls back to workspace root", () => {
    expect(
      resolveToolWorkspaceFileRoot({
        draftWorkspaceDirectory: null,
        sessionFileRoot: undefined,
        workspaceRoot: "/Users/me/ws",
      }),
    ).toBe("/Users/me/ws");
  });
});
