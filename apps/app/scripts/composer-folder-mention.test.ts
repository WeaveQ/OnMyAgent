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
    expect(browser).toContain("return (await addFiles(files)) > 0");
    expect(surface).toContain("prefix: path");
    expect(surface).toContain("shallow: true");
    expect(surface).toContain("readCodeWorkspaceBinaryFile");
    expect(surface).toContain("workspacePath: props.workspaceRoot");
    expect(surface).toContain("downloadWorkspaceFile");
    expect(surface).toContain("return new File([result.data], name");
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
});
