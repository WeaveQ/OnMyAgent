import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  closestEditableElement,
  isEditableElement,
  snapshotTextEditFlags,
} from "../src/react-app/design-system/text-edit-flags";

describe("text edit context menu flags", () => {
  test("treats inputs and contenteditable as editable", () => {
    const input = { tagName: "INPUT", readOnly: false, disabled: false };
    const readonly = { tagName: "TEXTAREA", readOnly: true, disabled: false };
    const editable = {
      tagName: "SPAN",
      closest: (selector: string) =>
        selector === '[contenteditable="true"]' ? { tagName: "DIV" } : null,
    };
    const plain = { tagName: "P", closest: () => null };
    expect(isEditableElement(input)).toBe(true);
    expect(isEditableElement(readonly)).toBe(false);
    expect(isEditableElement(editable)).toBe(true);
    expect(isEditableElement(plain)).toBe(false);
  });

  test("copy is allowed on a read-only selection; cut and paste are not", () => {
    const node = { tagName: "P", closest: () => null };
    const flags = snapshotTextEditFlags(
      { toString: () => "hello", anchorNode: node },
      node,
    );
    expect(flags).toEqual({ canCopy: true, canCut: false, canPaste: false });
  });

  test("cut and paste require an editable target", () => {
    const field = { tagName: "TEXTAREA", readOnly: false, disabled: false };
    const flags = snapshotTextEditFlags(
      { toString: () => "hello", anchorNode: field },
      field,
    );
    expect(flags).toEqual({ canCopy: true, canCut: true, canPaste: true });
  });

  test("closestEditableElement finds a textarea probe", () => {
    const field = {
      tagName: "TEXTAREA",
      readOnly: false,
      disabled: false,
      closest: (selector: string) =>
        selector.includes("textarea") ? field : null,
    };
    expect(closestEditableElement(field)).toBe(field);
  });

  test("closestEditableElement walks from a text-node probe to the field", () => {
    const field = {
      tagName: "TEXTAREA",
      readOnly: false,
      disabled: false,
      closest: (selector: string) =>
        selector.includes("textarea") ? field : null,
    };
    const textNode = {
      parentElement: field,
    };
    expect(closestEditableElement(textNode)).toBe(field);
  });
});

describe("text edit context menu wiring", () => {
  test("preview, transcript, and composers mount the shared edit menu", () => {
    const preview = readFileSync(
      join(import.meta.dir, "../src/react-app/capabilities/artifacts/preview.tsx"),
      "utf8",
    );
    const layout = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/session-surface-layout.tsx",
      ),
      "utf8",
    );
    const menu = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/design-system/text-edit-context-menu.tsx",
      ),
      "utf8",
    );
    expect(preview).toContain("TextEditContextMenu");
    expect(layout).toContain("TextEditContextMenu");
    const composer = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );
    const localAgent = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/local-agents/local-agent-draft-composer.tsx",
      ),
      "utf8",
    );
    expect(composer).toContain("TextEditContextMenu");
    expect(localAgent).toContain("TextEditContextMenu");
    expect(menu).toContain('t("common.cut")');
    expect(menu).toContain('t("common.copy")');
    expect(menu).toContain('t("common.paste")');
    expect(menu).toContain('t("common.select_all")');
    expect(menu).toContain("extraItems");
    expect(menu).toMatch(/flags\.canCut\s*\?/);
    expect(menu).toMatch(/flags\.canPaste\s*\?/);
    const pasteAt = menu.indexOf('t("common.paste")');
    const extraAt = menu.indexOf("{props.extraItems}");
    const selectAt = menu.indexOf('t("common.select_all")');
    expect(pasteAt).toBeGreaterThan(-1);
    expect(extraAt).toBeGreaterThan(pasteAt);
    expect(selectAt).toBeGreaterThan(extraAt);
  });

  test("transcript context menu can open the same save-to-knowledge dialog as the header", () => {
    const layout = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/session-surface-layout.tsx",
      ),
      "utf8",
    );
    const view = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/session-surface-view.tsx",
      ),
      "utf8",
    );
    const composer = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );
    expect(layout).toContain("onSaveToKnowledge");
    expect(layout).toContain('t("knowledge.save_to_knowledge")');
    expect(view).toContain("useKnowledgeArchiveSession");
    expect(view).toContain("onSaveToKnowledge=");
    expect(view).toContain("knowledgeArchive.dialog");
    expect(composer).not.toContain("onSaveToKnowledge");
    expect(composer).not.toContain("knowledge.save_to_knowledge");
  });
});
