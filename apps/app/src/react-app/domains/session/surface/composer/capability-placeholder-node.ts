import {
  $applyNodeReplacement,
  $createTextNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  COMMAND_PRIORITY_HIGH,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  ElementNode,
  type EditorConfig,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  PASTE_COMMAND,
  type SerializedElementNode,
  type Spread,
} from "lexical";

const SLOT_WRAPPER_CLASS = "inline";
const SLOT_BASE_CLASS =
  "inline-block min-w-px cursor-text rounded-sm bg-dls-accent/10 px-1 py-0.5 text-dls-accent outline-none [&[data-slot-empty=true]::after]:pointer-events-none [&[data-slot-empty=true]::after]:text-dls-accent/60 [&[data-slot-empty=true]::after]:content-[attr(data-slot-placeholder)]";
const SLOT_SPACER_CLASS =
  "inline-block w-0 select-none align-top overflow-hidden";
const SLOT_CARET_TEXT = "\u200B";

function getLegacyEmptySlotText(placeholder: string) {
  return `${SLOT_CARET_TEXT}${placeholder}`;
}

function createSlotSpacer() {
  const spacer = document.createElement("span");
  spacer.className = SLOT_SPACER_CLASS;
  spacer.contentEditable = "false";
  spacer.dataset.composerSlotSpacer = "";
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}

function getSlotInput(dom: HTMLElement) {
  const input = dom.querySelector<HTMLElement>("[data-composer-slot-input]");
  if (!input) {
    throw new Error("Composer placeholder input is missing");
  }
  return input;
}

type SerializedComposerPlaceholderNode = Spread<
  {
    placeholder: string;
    type: "composer-placeholder";
    version: 1;
  },
  SerializedElementNode
>;

export class ComposerPlaceholderNode extends ElementNode {
  __placeholder: string;

  static override getType() {
    return "composer-placeholder";
  }

  static override clone(node: ComposerPlaceholderNode) {
    return new ComposerPlaceholderNode(node.__placeholder, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerPlaceholderNode) {
    return $applyNodeReplacement(
      new ComposerPlaceholderNode(serializedNode.placeholder),
    ).updateFromJSON(serializedNode);
  }

  constructor(placeholder = "", key?: NodeKey) {
    super(key);
    this.__placeholder = placeholder;
  }

  override exportJSON(): SerializedComposerPlaceholderNode {
    return {
      ...super.exportJSON(),
      placeholder: this.__placeholder,
      type: "composer-placeholder",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig) {
    const dom = document.createElement("span");
    const slotValue = this.getSlotValue();
    dom.className = SLOT_WRAPPER_CLASS;
    dom.contentEditable = "false";
    dom.dataset.composerPlaceholder = this.__placeholder;
    dom.dataset.slotPlaceholder = slotValue ? "" : this.__placeholder;

    const input = document.createElement("span");
    input.className = SLOT_BASE_CLASS;
    input.contentEditable = "true";
    input.dataset.composerSlotInput = "";
    input.dataset.slotEmpty = slotValue ? "false" : "true";
    input.dataset.slotPlaceholder = this.__placeholder;
    input.setAttribute("aria-label", this.__placeholder);
    input.setAttribute("spellcheck", "false");

    dom.append(createSlotSpacer(), input, createSlotSpacer());
    return dom;
  }

  override getDOMSlot(element: HTMLElement) {
    return super.getDOMSlot(element).withElement(getSlotInput(element));
  }

  override updateDOM(
    prevNode: ComposerPlaceholderNode,
    dom: HTMLElement,
  ) {
    const slotValue = this.getSlotValue();
    const input = getSlotInput(dom);
    input.dataset.slotEmpty = slotValue ? "false" : "true";
    if (prevNode.__placeholder !== this.__placeholder) {
      dom.dataset.composerPlaceholder = this.__placeholder;
      input.dataset.slotPlaceholder = this.__placeholder;
      input.setAttribute("aria-label", this.__placeholder);
    }
    dom.dataset.slotPlaceholder = slotValue ? "" : this.__placeholder;
    return false;
  }

  override getTextContent(): string {
    const slotValue = this.getSlotValue();
    return slotValue || `<${this.getLatest().__placeholder}>`;
  }

  getPlaceholder(): string {
    return this.getLatest().__placeholder;
  }

  getSlotValue(): string {
    const latest = this.getLatest();
    const text = latest
      .getChildren()
      .map((child) => child.getTextContent())
      .join("");
    if (text === getLegacyEmptySlotText(latest.__placeholder)) return "";
    return text.replaceAll(SLOT_CARET_TEXT, "");
  }

  override isInline(): true {
    return true;
  }

  override canBeEmpty(): true {
    return true;
  }

  override canMergeWith(_node: ElementNode): false {
    return false;
  }

  override insertNewAfter(): null | LexicalNode {
    return null;
  }
}

export function $createComposerPlaceholderNode(placeholder: string) {
  const slot = $applyNodeReplacement(
    new ComposerPlaceholderNode(placeholder),
  );
  slot.append($createTextNode(SLOT_CARET_TEXT));
  return slot;
}

export function normalizeCapabilitySlotText(text: string) {
  return text.replace(/\s*\r?\n+\s*/g, " ");
}

function getSelectedSlot() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchorNode = selection.anchor.getNode();
  const focusNode = selection.focus.getNode();
  const anchorSlot =
    anchorNode instanceof ComposerPlaceholderNode
      ? anchorNode
      : anchorNode.getParent();
  const focusSlot =
    focusNode instanceof ComposerPlaceholderNode
      ? focusNode
      : focusNode.getParent();
  if (
    anchorSlot instanceof ComposerPlaceholderNode &&
    focusSlot instanceof ComposerPlaceholderNode &&
    anchorSlot.is(focusSlot)
  ) {
    return anchorSlot;
  }
  return null;
}

export function $selectComposerPlaceholderNode(
  slot: ComposerPlaceholderNode,
  selectValue = false,
) {
  const firstChild = slot.getFirstChild();
  if ($isTextNode(firstChild)) {
    const textSize = firstChild.getTextContentSize();
    if (selectValue && slot.getSlotValue()) {
      firstChild.select(0, textSize);
    } else {
      firstChild.select(textSize, textSize);
    }
    return;
  }
  slot.select(slot.getChildrenSize(), slot.getChildrenSize());
}

function insertIntoEmptySlot(slot: ComposerPlaceholderNode, text: string) {
  const normalizedText = normalizeCapabilitySlotText(text);
  if (!normalizedText || slot.getSlotValue()) return false;
  const textNode = $createTextNode(normalizedText);
  slot.clear();
  slot.append(textNode);
  textNode.select(normalizedText.length, normalizedText.length);
  return true;
}

export function registerCapabilitySlotEditing(editor: LexicalEditor) {
  const unregisterSlotTransform = editor.registerNodeTransform(
    ComposerPlaceholderNode,
    (slot) => {
      const firstChild = slot.getFirstChild();
      if (!firstChild) {
        slot.append($createTextNode(SLOT_CARET_TEXT));
        return;
      }
      if (
        slot.getChildrenSize() === 1 &&
        $isTextNode(firstChild) &&
        firstChild.getTextContent() ===
          getLegacyEmptySlotText(slot.getPlaceholder())
      ) {
        firstChild.setTextContent(SLOT_CARET_TEXT);
      }
    },
  );

  const unregisterInput = editor.registerCommand(
    CONTROLLED_TEXT_INSERTION_COMMAND,
    (payload) => {
      const text = typeof payload === "string" ? payload : payload.data;
      if (!text) return false;
      const slot = getSelectedSlot();
      return slot ? insertIntoEmptySlot(slot, text) : false;
    },
    COMMAND_PRIORITY_HIGH,
  );

  const unregisterPaste = editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      if (!("clipboardData" in event) || !event.clipboardData) return false;
      if (event.clipboardData.files.length > 0) return false;
      const slot = getSelectedSlot();
      if (!slot || slot.getSlotValue()) return false;
      const text = event.clipboardData.getData("text/plain");
      if (!text) return false;
      event.preventDefault();
      return insertIntoEmptySlot(slot, text);
    },
    COMMAND_PRIORITY_HIGH,
  );

  const unregisterTab = editor.registerCommand(
    KEY_TAB_COMMAND,
    (event) => {
      const slot = getSelectedSlot();
      if (!slot) return false;
      const slots = $nodesOfType(ComposerPlaceholderNode);
      const currentIndex = slots.findIndex((candidate) => candidate.is(slot));
      const nextIndex = currentIndex + (event.shiftKey ? -1 : 1);
      const nextSlot = slots[nextIndex];
      if (!nextSlot) return false;

      event.preventDefault();
      $selectComposerPlaceholderNode(nextSlot, true);
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );

  const protectSlotBoundary = (direction: "backward" | "forward") => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return false;
    const anchorNode = selection.anchor.getNode();
    const focusNode = selection.focus.getNode();
    const anchorSlot =
      anchorNode instanceof ComposerPlaceholderNode
        ? anchorNode
        : anchorNode.getParent();
    const focusSlot =
      focusNode instanceof ComposerPlaceholderNode
        ? focusNode
        : focusNode.getParent();

    if (
      anchorSlot instanceof ComposerPlaceholderNode &&
      focusSlot instanceof ComposerPlaceholderNode &&
      anchorSlot.is(focusSlot) &&
      !anchorSlot.getSlotValue()
    ) {
      const parent = anchorSlot.getParent();
      const index = anchorSlot.getIndexWithinParent();
      anchorSlot.remove();
      if ($isElementNode(parent)) parent.select(index, index);
      return true;
    }

    if (!selection.isCollapsed()) return false;
    const anchorOffset = selection.anchor.offset;

    if (anchorNode instanceof ComposerPlaceholderNode) {
      return true;
    }

    if (
      $isTextNode(anchorNode) &&
      anchorNode.getParent() instanceof ComposerPlaceholderNode
    ) {
      const text = anchorNode.getTextContent();
      const before = text
        .slice(0, anchorOffset)
        .replaceAll(SLOT_CARET_TEXT, "");
      const after = text
        .slice(anchorOffset)
        .replaceAll(SLOT_CARET_TEXT, "");
      if (direction === "backward" && !before) return true;
      if (direction === "forward" && !after) return true;
    }

    if ($isTextNode(anchorNode)) {
      const atBoundary =
        direction === "backward"
          ? anchorOffset === 0
          : anchorOffset === anchorNode.getTextContentSize();
      if (atBoundary) {
        const adjacent =
          direction === "backward"
            ? anchorNode.getPreviousSibling()
            : anchorNode.getNextSibling();
        if (adjacent instanceof ComposerPlaceholderNode) {
          if (!adjacent.getSlotValue()) {
            adjacent.remove();
          } else {
            const offset =
              direction === "backward" ? adjacent.getChildrenSize() : 0;
            adjacent.select(offset, offset);
          }
          return true;
        }
      }
    }

    if ($isElementNode(anchorNode)) {
      const adjacent =
        direction === "backward"
          ? anchorNode.getChildAtIndex(anchorOffset - 1)
          : anchorNode.getChildAtIndex(anchorOffset);
      if (adjacent instanceof ComposerPlaceholderNode) {
        if (!adjacent.getSlotValue()) {
          const index = adjacent.getIndexWithinParent();
          adjacent.remove();
          anchorNode.select(index, index);
          return true;
        }
        const offset =
          direction === "backward" ? adjacent.getChildrenSize() : 0;
        adjacent.select(offset, offset);
        return true;
      }
    }

    return false;
  };

  const unregisterBackspace = editor.registerCommand(
    KEY_BACKSPACE_COMMAND,
    (event) => {
      const handled = protectSlotBoundary("backward");
      if (handled) event.preventDefault();
      return handled;
    },
    COMMAND_PRIORITY_HIGH,
  );
  const unregisterDelete = editor.registerCommand(
    KEY_DELETE_COMMAND,
    (event) => {
      const handled = protectSlotBoundary("forward");
      if (handled) event.preventDefault();
      return handled;
    },
    COMMAND_PRIORITY_HIGH,
  );

  return () => {
    unregisterSlotTransform();
    unregisterInput();
    unregisterPaste();
    unregisterTab();
    unregisterBackspace();
    unregisterDelete();
  };
}
