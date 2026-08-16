import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import {
  activateOrReuseTab,
  addKnowledgeEditorTab,
  closeKnowledgeEditorTab,
  createKnowledgeEditorTab,
} from "../src/react-app/domains/knowledge/knowledge-vault-tabs";

const noteA = { scope: "user" as const, relPath: "a.md" };
const noteB = { scope: "user" as const, relPath: "b.md" };

describe("knowledge editor tabs", () => {
  test("reuses a tab that already has the note", () => {
    const first = createKnowledgeEditorTab(noteA, "A");
    const second = createKnowledgeEditorTab(null);
    const next = activateOrReuseTab([first, second], second.id, noteA, "A");
    expect(next.activeId).toBe(first.id);
    expect(next.tabs).toHaveLength(2);
  });

  test("closing the last tab leaves an empty tab", () => {
    const only = createKnowledgeEditorTab(noteA, "A");
    const next = closeKnowledgeEditorTab([only], only.id);
    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0]?.note).toBeNull();
  });

  test("adding a tab activates the empty one", () => {
    const first = createKnowledgeEditorTab(noteB, "B");
    const next = addKnowledgeEditorTab([first]);
    expect(next.tabs).toHaveLength(2);
    expect(next.activeId).toBe(next.tabs[1]?.id);
    expect(next.tabs[1]?.note).toBeNull();
  });

  test("opening another note appends a new tab instead of replacing the first", () => {
    const first = createKnowledgeEditorTab(noteA, "A");
    const next = activateOrReuseTab([first], first.id, noteB, "B");
    expect(next.tabs).toHaveLength(2);
    expect(next.tabs[0]?.note?.relPath).toBe("a.md");
    expect(next.tabs[1]?.note?.relPath).toBe("b.md");
    expect(next.activeId).toBe(next.tabs[1]?.id);
  });

  test("tab chrome uses a fixed width and ellipsis", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../src/react-app/domains/knowledge/knowledge-vault-tab-bar.tsx"),
      "utf8",
    );
    expect(source).toContain("w-36");
    expect(source).toContain("truncate");
    expect(source).toContain("justify-center");
    expect(source).toContain("text-center");
    expect(source).not.toContain("border-r border-dls-border");
    expect(source).toContain("mac:titlebar-no-drag");
    expect(source).toContain("cursor-pointer");
    expect(source).not.toContain("max-w-48");
    expect(source).not.toContain("min-w-28");
  });

  test("fills an empty active tab instead of leaving a blank leftover", () => {
    const empty = createKnowledgeEditorTab();
    const next = activateOrReuseTab([empty], empty.id, noteA, "A");
    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0]?.note?.relPath).toBe("a.md");
    expect(next.activeId).toBe(empty.id);
  });
});
