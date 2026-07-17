import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("session visual and file contracts", () => {
  test("chat markdown surfaces use muted gray backgrounds", () => {
    const markdown = readWorkspaceFile(
      "apps/app/src/react-app/capabilities/artifacts/markdown.tsx",
    );
    const messageItem = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/message-list/message-item.tsx",
    );
    const messageStyles = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/message-list/styles.ts",
    );
    const messageContent = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/message-list/message-content.tsx",
    );
    const messageListBarrel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/message-list.tsx",
    );

    expect(markdown).not.toContain("bg-dls-hover p-2 text-left");
    expect(markdown).toContain("rounded-xl border border-dls-mist bg-dls-surface-muted");
    expect(markdown).toContain(
      "session-markdown-table-header border px-4 py-2 text-left font-semibold",
    );
    expect(markdown).toContain("session-markdown-table-cell border px-4 py-2 align-top");
    expect(messageItem).not.toContain("hover:bg-primary/10");
    // Bubble tokens live in styles.ts; file/resource chips keep muted surface in message-content.
    expect(messageStyles).toContain("bg-dls-chat-user-bg text-dls-text");
    expect(messageContent).toContain("bg-dls-surface-muted text-dls-text");
    expect(messageListBarrel).toContain('from "./message-list/index"');
  });

  test("code open-location menu uses real editor icon assets and smaller radius", () => {
    const toolbar = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/code-scene-toolbar.tsx",
    );
    const iconNames = ["vscode", "cursor", "finder", "terminal", "xcode", "android-studio"];

    expect(toolbar).not.toContain(
      'className="rounded-full border-dls-border bg-dls-surface font-medium',
    );
    expect(toolbar).toContain(
      'className="rounded-lg border-dls-border bg-dls-surface font-medium',
    );
    expect(toolbar).toContain('src={resolvePublicAssetUrl("/editor-icons/vscode.png")}');
    expect(toolbar).toContain("iconAssetByTargetId");
    expect(toolbar).toContain("OpenTargetMenuIcon");

    for (const name of iconNames) {
      expect(toolbar).toContain(`/editor-icons/${name}.png`);
      expect(existsSync(join(repoRoot, `apps/app/public/editor-icons/${name}.png`))).toBe(true);
    }
  });

  test("workspace files page previews file content and routes browser targets through open artifacts", () => {
    const filesPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
    );
    const chatPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/chat/session-page.tsx",
    );
    const assistantPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/assistant.tsx",
    );
    const expertPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/pages/expert.tsx",
    );

    expect(filesPage).toContain("workspaceFileOpenTarget");
    expect(filesPage).toContain("readWorkspaceFile(props.workspaceId, selectedTarget.value)");
    expect(filesPage).toContain('selectedTarget.preview === "browser"');
    expect(filesPage).toContain("props.onOpenArtifact?.(target)");
    expect(filesPage).toContain("MarkdownPreview content={state.content}");
    expect(filesPage).toContain("PlainText content={state.content}");

    for (const source of [chatPage, assistantPage, expertPage]) {
      expect(source).toContain("onOpenArtifact={openTarget}");
    }
  });
});
