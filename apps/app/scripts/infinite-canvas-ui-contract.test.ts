import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("infinite canvas UI contract", () => {
  test("registers canvas as a side panel item", () => {
    const source = readWorkspaceFile("apps/app/src/react-app/shell/ui-state-store.ts");

    expect(source).toContain('"canvas"');
  });

  test("assistant and expert pages expose no-drag canvas buttons", () => {
    const assistant = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/assistant.tsx");
    const expert = readWorkspaceFile("apps/app/src/react-app/domains/session/pages/expert.tsx");

    for (const source of [assistant, expert]) {
      expect(source).toContain("InfiniteCanvasPanel");
      expect(source).toContain('toggleCurrentSidePanel("canvas")');
      expect(source).toContain("mac:titlebar-no-drag");
      expect(source).toContain('t("infinite_canvas.open")');
    }
  });

  test("all locale indexes include infinite canvas strings", () => {
    for (const locale of ["en", "zh", "zh-TW"]) {
      const index = readWorkspaceFile(`apps/app/src/i18n/locales/${locale}/index.ts`);
      const messages = readWorkspaceFile(`apps/app/src/i18n/locales/${locale}/infinite_canvas.ts`);

      expect(index).toContain("infiniteCanvas");
      expect(messages).toContain('"infinite_canvas.open"');
      expect(messages).toContain('"infinite_canvas.template.architecture"');
      expect(messages).toContain('"infinite_canvas.status_save_failed"');
    }
  });

  test("autosave keeps the mounted tldraw snapshot stable", () => {
    const source = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/infinite-canvas/infinite-canvas-panel.tsx",
    );

    expect(source).toContain("snapshotRef.current = nextSnapshot");
    expect(source).toContain("snapshot={initialSnapshot.document ?? undefined}");
    expect(source).not.toContain("setSnapshot(nextSnapshot)");
  });
});
