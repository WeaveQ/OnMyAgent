export type TextEditFlags = {
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
};

type EditProbe = {
  tagName?: string;
  readOnly?: boolean;
  disabled?: boolean;
  parentElement?: EditProbe | null;
  closest?: (selector: string) => EditProbe | null;
};

function asEditProbe(
  node: EventTarget | Node | EditProbe | null,
): EditProbe | null {
  if (!node || typeof node !== "object") return null;
  return node as EditProbe;
}

export function isEditableElement(
  node: EventTarget | Node | EditProbe | null,
): boolean {
  const el = asEditProbe(node);
  if (!el) return false;
  const tag = String(el.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA") {
    return !el.readOnly && !el.disabled;
  }
  if (typeof el.closest === "function") {
    return Boolean(el.closest('[contenteditable="true"]'));
  }
  return isEditableElement(el.parentElement ?? null);
}

export function snapshotTextEditFlags(
  selection: Pick<Selection, "toString" | "anchorNode"> | null,
  active: EventTarget | Node | null,
): TextEditFlags {
  const hasText = Boolean(selection?.toString());
  const editable =
    isEditableElement(active) || isEditableElement(selection?.anchorNode ?? null);
  return {
    canCopy: hasText,
    canCut: hasText && editable,
    canPaste: editable,
  };
}

export function selectNodeContents(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}
