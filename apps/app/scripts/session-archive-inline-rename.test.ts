import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

describe("session archive inline rename contract", () => {
  it("does not use browser prompt for session rename", () => {
    const source = readFileSync("src/react-app/domains/session/chat/session-page-session-archive-page.tsx", "utf8");
    expect(source).not.toContain("window.prompt");
    expect(source).toContain("renamingSessionId");
    expect(source).toContain("submitRename");
  });

  it("exposes row context actions from the virtual session list", () => {
    const source = readFileSync("src/react-app/domains/session/chat/session-page-session-archive-components.tsx", "utf8");
    expect(source).toContain("onRenameSession");
    expect(source).toContain("onOpenSessionDirectory");
    expect(source).toContain("onTrashSession");
  });
});
