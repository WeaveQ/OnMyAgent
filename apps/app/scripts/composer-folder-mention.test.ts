import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const appRoot = path.resolve(import.meta.dir, "..");

function read(relativePath: string) {
  return readFileSync(path.join(appRoot, relativePath), "utf8");
}

describe("@ folder file selection contract", () => {
  test("opens directories instead of inserting directory mentions", () => {
    const composer = read(
      "src/react-app/domains/session/surface/composer/composer.tsx",
    );
    expect(composer).toContain('if (item.kind === "directory")');
    expect(composer).toContain("mentionBrowser.openFolder(item.value)");
    expect(composer).toContain("props.onInsertMention(item.kind, item.value)");
  });

  test("loads selected workspace files through the existing attachment intake", () => {
    const composer = read(
      "src/react-app/domains/session/surface/composer/composer.tsx",
    );
    const surface = read(
      "src/react-app/domains/session/surface/session-surface.tsx",
    );
    const browser = read(
      "src/react-app/domains/session/surface/composer/use-mention-folder-browser.ts",
    );
    expect(composer).toContain("mentionBrowser.addSelectedFiles");
    expect(composer).toContain("mentionBrowser.selectedFilePaths");
    expect(browser).toContain("const files = await loadFiles(paths)");
    expect(browser).toContain("const added = await addFiles(files)");
    expect(browser).toContain("setSelectedFilePaths(new Set())");
    expect(surface).toContain("listSessionMentionFolder");
    expect(surface).toContain("loadSessionMentionFiles");
    expect(surface).toContain("searchSessionMentionTargets");
    expect(surface).toContain("filesWorkspaceRoot");
    const mentionFiles = read(
      "src/react-app/domains/session/surface/session-surface-mention-files.ts",
    );
    expect(mentionFiles).toContain("prefix: relativePath");
    expect(mentionFiles).toContain("shallow: true");
    expect(mentionFiles).toContain("readCodeWorkspaceBinaryFile");
    expect(mentionFiles).toContain("workspacePath: workspaceRoot");
    expect(mentionFiles).toContain("downloadWorkspaceFile");
    expect(mentionFiles).toContain("mentionFileDownloadCandidates");
    expect(mentionFiles).toContain("new File([new Uint8Array(result.data)], name");
    // Catalog must not use session cwd as list root (download is workspace-relative).
    expect(mentionFiles).not.toContain("root: workspaceRoot");
  });

  test("uses shared row, checkbox, button, and loading primitives", () => {
    const menu = read(
      "src/react-app/domains/session/surface/composer/slash-mention-menus.tsx",
    );
    expect(menu).toContain('from "@/components/ui/action-row"');
    expect(menu).toContain('from "@/components/ui/button"');
    expect(menu).toContain('from "@/components/ui/checkbox"');
    expect(menu).toContain('from "@/components/ui/loading-spinner"');
    expect(menu).toContain("props.onAddSelectedFiles();");
    expect(menu).toContain("if (event.detail === 0) props.onAddSelectedFiles()");
    expect(menu).toContain('role="alert"');
  });

  test("mention roots use three-source targets with labels not raw disk dump", () => {
    const targets = read(
      "src/react-app/capabilities/artifacts/workspace-mention-targets.ts",
    );
    const browser = read(
      "src/react-app/domains/session/surface/composer/use-mention-folder-browser.ts",
    );
    const surface = read(
      "src/react-app/domains/session/surface/session-surface.tsx",
    );
    const mentionFiles = read(
      "src/react-app/domains/session/surface/session-surface-mention-files.ts",
    );
    expect(targets).toContain("workspaceMentionRootTargets");
    expect(targets).toContain("files.source_uploads");
    expect(targets).toContain("files.source_task");
    expect(targets).toContain("files.source_expert");
    expect(targets).toContain("SYSTEM_ROOT_FILES");
    expect(browser).toContain("target.label");
    expect(browser).toContain("subtitle");
    expect(surface).toContain("listSessionMentionFolder");
    expect(mentionFiles).toContain("mergeTaskSourceDirectoryTargets");
    expect(mentionFiles).toContain("WORKSPACE_TASKS_DIR");
  });
});
