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
    const messageList = [
      "apps/app/src/react-app/domains/session/surface/message-list.tsx",
      "apps/app/src/react-app/domains/session/surface/message-list/styles.ts",
      "apps/app/src/react-app/domains/session/surface/message-list/file-card.tsx",
    ].map(readWorkspaceFile).join("\n");

    expect(markdown).not.toContain("bg-dls-hover p-2 text-left");
    expect(markdown).toContain("rounded-xl border border-dls-mist bg-dls-surface-muted");
    // Table frame border lives on the outer shell; cells use internal grid only.
    expect(markdown).toContain(
      'class="session-markdown-table my-4 overflow-x-auto rounded-xl border"',
    );
    expect(markdown).toContain(
      "session-markdown-table-header px-4 py-2 text-left font-semibold",
    );
    expect(markdown).toContain("session-markdown-table-cell px-4 py-2 align-top");
    expect(markdown).not.toContain(
      "session-markdown-table-header border px-4 py-2 text-left font-semibold",
    );
    expect(messageList).not.toContain("hover:bg-primary/10");
    expect(messageList).toContain("bg-dls-chat-user-bg text-dls-text");
    expect(messageList).toContain("bg-dls-surface-muted text-dls-text");
    expect(messageList).toContain("export const SessionTranscript");
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

  test("workspace files page preserves text, HTML, image, and Office preview branches", () => {
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
    expect(filesPage).toContain("downloadWorkspaceFile(props.workspaceId, selectedTarget.value)");
    expect(filesPage).toContain("props.onOpenArtifact?.(target)");
    expect(filesPage).toContain("MarkdownPreview content={state.content}");
    expect(filesPage).toContain('<HTMLPreview type="text"');
    expect(filesPage).toContain("<ImagePreview");
    expect(filesPage).toContain("PlainText content={state.content}");
    expect(filesPage).toContain("<OfficeFilePreview");

    for (const source of [chatPage, assistantPage, expertPage]) {
      expect(source).toContain("onOpenArtifact={openTarget}");
    }
  });

  test("session file tab exposes artifact actions and type-aware previews", () => {
    const sidePanel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
    );

    expect(sidePanel).toContain('t("files.file_actions", { name: props.node.name })');
    expect(sidePanel).toContain('t("files.open_in_folder")');
    expect(sidePanel).toContain('t("session.open_artifact")');
    expect(sidePanel).toContain('t("files.preview_unsupported")');
    expect(sidePanel).toContain('targetPreview === "external"');
    expect(sidePanel).toContain("usesLocalFileRenderer");
    expect(sidePanel).toContain('preview === "audio"');
    expect(sidePanel).toContain('preview === "video"');
    expect(sidePanel).toContain("canEditArtifactTarget");
    expect(sidePanel).toContain("<OfficeFilePreview");
    expect(sidePanel).toContain('targetPreview === "image"');
    expect(sidePanel).toContain('targetPreview === "html"');
    expect(sidePanel).toContain('<HTMLPreview className="min-h-0 flex-1" type="text"');
    expect(sidePanel).not.toContain('setPreview({ kind: "browser"');
    expect(sidePanel).toContain("client.downloadWorkspaceFile(workspaceId, requestPath)");
    expect(sidePanel).toContain("client.deleteWorkspaceFile(");
    expect(sidePanel).toContain("<ConfirmModal");
    expect(sidePanel).not.toContain("Only supported text artifact files can be read inline");
  });

  test("every filename-bearing app surface uses the shared type-aware file icon", () => {
    const expectedUsageByFile = new Map<string, string>([
      ["apps/app/src/react-app/domains/workspace/workspace-files-page.tsx", "name={props.node.name}"],
      ["apps/app/src/react-app/domains/session/surface/code-workspace-side-panel.tsx", "name={props.node.name}"],
      ["apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx", "name={item.name || item.value}"],
      ["apps/app/src/react-app/domains/session/surface/message-list/file-card.tsx", "name={title}"],
      ["apps/app/src/react-app/domains/session/surface/message-list/message-block-row.tsx", "name={props.target.name || props.target.value}"],
      ["apps/app/src/react-app/domains/session/surface/transcript-resource-chip.tsx", "name={label}"],
      ["apps/app/src/react-app/domains/session/surface/composer/composer.tsx", "name={attachment.name}"],
      ["apps/app/src/react-app/domains/session/surface/composer/slash-mention-menus.tsx", "name={item.value || item.label}"],
      ["apps/app/src/react-app/domains/local-agents/local-agent-draft-composer.tsx", "name={entry.name}"],
      ["apps/app/src/react-app/domains/local-agents/messages/chat-bubble.tsx", "name={target.name || target.value}"],
      ["apps/app/src/react-app/domains/local-agents/messages/message-file-changes.tsx", "name={entry.fileName || entry.filePath}"],
      ["apps/app/src/react-app/domains/session/surface/specialized-tool-details.tsx", "name={item.fileName || item.path}"],
      ["apps/app/src/react-app/shell/command-palette.tsx", "name={target.name || target.value}"],
    ]);

    for (const [path, filenameBinding] of expectedUsageByFile) {
      const source = readWorkspaceFile(path);
      expect(source).toContain("ArtifactIcon");
      expect(source).toContain(filenameBinding);
    }
  });
});
