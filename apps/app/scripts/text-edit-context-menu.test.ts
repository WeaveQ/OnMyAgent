import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
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
});

describe("text edit context menu wiring", () => {
  test("preview and transcript body mount the shared edit menu", () => {
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
    expect(menu).toContain('t("common.cut")');
    expect(menu).toContain('t("common.copy")');
    expect(menu).toContain('t("common.paste")');
    expect(menu).toContain('t("common.select_all")');
  });
});
