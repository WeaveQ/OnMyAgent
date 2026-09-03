import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildSlashCommands } from "../src/react-app/domains/knowledge/knowledge-slash-menu";

const domRoot = join(import.meta.dir, "..", "src", "react-app", "domains", "knowledge");

function read(rel: string): string {
  return readFileSync(join(domRoot, rel), "utf8");
}

describe("knowledge block editor wiring", () => {
  test("Plate editor is loaded through a React.lazy boundary", () => {
    const source = read("knowledge-vault-editor.tsx");
    // The heavy Plate/Slate chunk must not be a static import in the rail entry.
    expect(source).toContain("lazy(() =>");
    expect(source).toContain('"./knowledge-block-editor"');
    // Markdown notes use the block editor; plain text keeps the legacy editor.
    expect(source).toContain('props.language === "markdown"');
  });

  test("slash menu covers the required base blocks", () => {
    const commands = buildSlashCommands();
    const keys = new Set(commands.map((c) => c.key));
    for (const required of [
      "paragraph",
      "h1",
      "h2",
      "h3",
      "bulleted-list",
      "numbered-list",
      "todo",
      "quote",
      "code",
    ]) {
      expect(keys.has(required), `missing slash command: ${required}`).toBe(true);
    }
    // Each command has a runnable action and a label.
    for (const cmd of commands) {
      expect(typeof cmd.run).toBe("function");
      expect(cmd.label.length).toBeGreaterThan(0);
    }
  });

  test("block editor declares its plugins (headings/lists/code/quote/table)", () => {
    const source = read("knowledge-block-editor.tsx");
    for (const plugin of [
      "BaseH1Plugin",
      "BaseH6Plugin",
      "BaseListPlugin",
      "BaseCodeBlockPlugin",
      "BaseBlockquotePlugin",
      "BaseTablePlugin",
    ]) {
      expect(source, `missing plugin ${plugin}`).toContain(plugin);
    }
  });
});
