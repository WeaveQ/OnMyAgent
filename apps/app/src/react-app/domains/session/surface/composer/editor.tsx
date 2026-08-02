/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer.js";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin.js";
import { ContentEditable } from "@lexical/react/LexicalContentEditable.js";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary.js";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin.js";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin.js";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext.js";
import {
  $applyNodeReplacement,
  $createRangeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $nodesOfType,
  $setSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  type SerializedTextNode,
  type Spread,
  TextNode,
  type EditorConfig,
  type NodeKey,
} from "lexical";
import type { InitialConfigType } from "@lexical/react/LexicalComposer.js";
import type { ComposerMentionKind } from "../../../../../app/types";
import {
  detectKeymapPlatform,
  matchKeymapAction,
} from "../../../../kernel/keymap";
import { decodeComposerMentionValue, encodeComposerMentionValue } from "./mention-encoding";
import {
  COMPOSER_TEMPLATE_EVENTS,
  splitCapabilityTemplate,
} from "./capability-template";
import {
  $createComposerPlaceholderNode,
  $selectComposerPlaceholderNode,
  ComposerPlaceholderNode,
  registerCapabilitySlotEditing,
} from "./capability-placeholder-node";

type EditorProps = {
  sessionId: string;
  value: string;
  mentions: Record<string, ComposerMentionKind>;
  scenarioTags?: Array<{ id: string; label: string }>;
  disabled: boolean;
  placeholder: string;
  /** Shorter empty-state min height (draft home). */
  compact?: boolean;
  /** Assistant new-task hero: taller empty field under the brand title. */
  hero?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
};

/**
 * Composer inline tokens. Dark mode: avoid accent/10 + accent/30 (too dim on
 * #1f1f1f). Prefer decision-soft fill + icon-fg text (light #005DFF / dark #7FB0FF).
 */
const composerEditorTokenClass = {
  fileMention:
    "inline-flex items-center rounded-md border border-dls-border-strong bg-dls-surface-muted px-2.5 py-1 text-xs font-medium text-dls-text",
  agentMention:
    "inline-flex items-center rounded-md border border-dls-accent/50 bg-dls-decision-soft px-2.5 py-1 text-xs font-medium text-dls-icon-fg",
  slashCommand:
    "inline-flex items-center gap-0.5 rounded-md border border-dls-accent/50 bg-dls-decision-soft py-1 pe-1 ps-2.5 text-xs font-medium text-dls-icon-fg",
  slashCommandButton:
    "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-dls-icon-fg transition-colors hover:bg-dls-accent/20 hover:text-dls-icon-fg",
  scenario:
    "inline-flex items-center gap-1 rounded-md border border-dls-accent/50 bg-dls-decision-soft px-2.5 py-1 text-xs font-medium text-dls-icon-fg",
  scenarioButton:
    "ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-dls-icon-fg transition-colors hover:bg-dls-accent/20 hover:text-dls-icon-fg",
};

type SerializedComposerMentionNode = Spread<
  {
    mentionValue: string;
    mentionKind: ComposerMentionKind;
    type: "composer-mention";
    version: 1;
  },
  SerializedTextNode
>;

type SerializedComposerSlashCommandNode = Spread<
  {
    commandName: string;
    type: "composer-slash-command";
    version: 1;
  },
  SerializedTextNode
>;

type SerializedComposerScenarioNode = Spread<
  {
    scenarioId: string;
    scenarioLabel: string;
    type: "composer-scenario";
    version: 1;
  },
  SerializedTextNode
>;

class ComposerMentionNode extends TextNode {
  __value: string;
  __kind: ComposerMentionKind;

  static override getType() {
    return "composer-mention";
  }

  static override clone(node: ComposerMentionNode) {
    return new ComposerMentionNode(node.__value, node.__kind, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerMentionNode) {
    return $createComposerMentionNode(serializedNode.mentionValue, serializedNode.mentionKind);
  }

  constructor(value = "", kind: ComposerMentionKind = "file", key?: NodeKey) {
    super(`@${encodeComposerMentionValue(value)}`, key);
    this.__value = value;
    this.__kind = kind;
  }

  override exportJSON(): SerializedComposerMentionNode {
    return {
      ...super.exportJSON(),
      mentionValue: this.__value,
      mentionKind: this.__kind,
      type: "composer-mention",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig) {
    const dom = document.createElement("span");
    const isPath = this.__kind !== "agent";
    dom.className = isPath ? composerEditorTokenClass.fileMention : composerEditorTokenClass.agentMention;
    dom.textContent = `@${isPath ? this.__value.split(/[\\/]/).pop() || this.__value : this.__value}`;
    dom.contentEditable = "false";
    dom.setAttribute("spellcheck", "false");
    dom.title = `@${this.__value}`;
    return dom;
  }

  override updateDOM(prevNode: ComposerMentionNode, dom: HTMLElement) {
    if (prevNode.__value !== this.__value || prevNode.__kind !== this.__kind) {
      const isPath = this.__kind !== "agent";
      dom.className = isPath ? composerEditorTokenClass.fileMention : composerEditorTokenClass.agentMention;
      dom.textContent = `@${isPath ? this.__value.split(/[\\/]/).pop() || this.__value : this.__value}`;
      dom.title = `@${this.__value}`;
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

function $createComposerMentionNode(value: string, kind: ComposerMentionKind) {
  return $applyNodeReplacement(new ComposerMentionNode(value, kind));
}

class ComposerSlashCommandNode extends TextNode {
  __commandName: string;

  static override getType() {
    return "composer-slash-command";
  }

  static override clone(node: ComposerSlashCommandNode) {
    return new ComposerSlashCommandNode(node.__commandName, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerSlashCommandNode) {
    return $createComposerSlashCommandNode(serializedNode.commandName);
  }

  constructor(commandName = "", key?: NodeKey) {
    super(`/${commandName}`, key);
    this.__commandName = commandName;
  }

  override exportJSON(): SerializedComposerSlashCommandNode {
    return {
      ...super.exportJSON(),
      commandName: this.__commandName,
      type: "composer-slash-command",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig) {
    const dom = document.createElement("span");
    dom.className = composerEditorTokenClass.slashCommand;
    dom.contentEditable = "false";
    dom.setAttribute("spellcheck", "false");
    dom.title = `/${this.__commandName}`;

    const text = document.createElement("span");
    text.textContent = `/${this.__commandName}`;

    // Clickable × — same pattern as scenario / attachment chips.
    const button = document.createElement("button");
    button.type = "button";
    button.className = composerEditorTokenClass.slashCommandButton;
    button.title = "Remove";
    button.setAttribute("aria-label", "Remove");
    button.dataset.slashCommandRemove = this.__commandName;
    button.textContent = "×";

    dom.append(text, button);
    return dom;
  }

  override updateDOM(prevNode: ComposerSlashCommandNode, dom: HTMLElement) {
    if (prevNode.__commandName !== this.__commandName) {
      const text = dom.firstElementChild;
      if (text) text.textContent = `/${this.__commandName}`;
      const button = dom.querySelector("button[data-slash-command-remove]");
      if (button instanceof HTMLButtonElement) {
        button.dataset.slashCommandRemove = this.__commandName;
      }
      dom.title = `/${this.__commandName}`;
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

function $createComposerSlashCommandNode(commandName: string) {
  return $applyNodeReplacement(new ComposerSlashCommandNode(commandName));
}

class ComposerScenarioNode extends TextNode {
  __scenarioId: string;
  __scenarioLabel: string;

  static override getType() {
    return "composer-scenario";
  }

  static override clone(node: ComposerScenarioNode) {
    return new ComposerScenarioNode(node.__scenarioId, node.__scenarioLabel, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerScenarioNode) {
    return $createComposerScenarioNode(serializedNode.scenarioId, serializedNode.scenarioLabel);
  }

  constructor(id = "", label = "", key?: NodeKey) {
    super(`[[assistant-scenario:${id}]]`, key);
    this.__scenarioId = id;
    this.__scenarioLabel = label;
  }

  override exportJSON(): SerializedComposerScenarioNode {
    return {
      ...super.exportJSON(),
      scenarioId: this.__scenarioId,
      scenarioLabel: this.__scenarioLabel,
      type: "composer-scenario",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig) {
    const dom = document.createElement("span");
    dom.className = composerEditorTokenClass.scenario;
    dom.contentEditable = "false";
    dom.setAttribute("spellcheck", "false");
    dom.title = this.__scenarioLabel;

    const text = document.createElement("span");
    text.textContent = this.__scenarioLabel;

    const button = document.createElement("button");
    button.type = "button";
    button.className = composerEditorTokenClass.scenarioButton;
    button.title = "Remove";
    button.setAttribute("aria-label", "Remove");
    button.dataset.scenarioRemoveId = this.__scenarioId;
    button.textContent = "×";

    dom.append(text, button);
    return dom;
  }

  override updateDOM(prevNode: ComposerScenarioNode, dom: HTMLElement) {
    if (
      prevNode.__scenarioId !== this.__scenarioId ||
      prevNode.__scenarioLabel !== this.__scenarioLabel
    ) {
      const text = dom.firstElementChild;
      if (text) text.textContent = this.__scenarioLabel;
      const button = dom.querySelector("button[data-scenario-remove-id]");
      if (button instanceof HTMLButtonElement) {
        button.dataset.scenarioRemoveId = this.__scenarioId;
      }
      dom.title = this.__scenarioLabel;
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

function $createComposerScenarioNode(id: string, label: string) {
  return $applyNodeReplacement(new ComposerScenarioNode(id, label));
}

type ComposerInlineTokenNode =
  | ComposerMentionNode
  | ComposerSlashCommandNode
  | ComposerScenarioNode
  | ComposerPlaceholderNode;

function setSelectionAfterNode(node: ComposerInlineTokenNode) {
  const parent = node.getParent();
  if (!parent || !$isElementNode(parent)) return;
  const selection = $createRangeSelection();
  const offset = node.getIndexWithinParent() + 1;
  selection.anchor.set(parent.getKey(), offset, "element");
  selection.focus.set(parent.getKey(), offset, "element");
  $setSelection(selection);
}

function setSelectionBeforeNode(node: ComposerInlineTokenNode) {
  const parent = node.getParent();
  if (!parent || !$isElementNode(parent)) return;
  const selection = $createRangeSelection();
  const offset = node.getIndexWithinParent();
  selection.anchor.set(parent.getKey(), offset, "element");
  selection.focus.set(parent.getKey(), offset, "element");
  $setSelection(selection);
}

function appendSegmentWithNewlines(
  paragraph: ReturnType<typeof $createParagraphNode>,
  segment: string,
) {
  // Preserve newlines in plain text segments. A single paragraph cannot
  // render "\n" as a line break in contenteditable, so we split on "\n"
  // and start a new paragraph per line. Return the paragraph the caller
  // should keep appending to (i.e. the last one we produced).
  if (!segment.includes("\n")) {
    paragraph.append($createTextNode(segment));
    return paragraph;
  }
  const lines = segment.split("\n");
  let current = paragraph;
  lines.forEach((line, index) => {
    if (index > 0) {
      const next = $createParagraphNode();
      current.insertAfter(next);
      current = next;
    }
    if (line.length > 0) {
      current.append($createTextNode(line));
    }
  });
  return current;
}

function appendCapabilityTemplateSegment(
  paragraph: ReturnType<typeof $createParagraphNode>,
  segment: string,
) {
  let current = paragraph;
  for (const part of splitCapabilityTemplate(segment)) {
    if (part.kind === "placeholder") {
      current.append($createComposerPlaceholderNode(part.value));
    } else {
      current = appendSegmentWithNewlines(current, part.value);
    }
  }
  return current;
}

function setPrompt(
  value: string,
  mentions: Record<string, ComposerMentionKind>,
  scenarioTags?: Array<{ id: string; label: string }>,
  capabilityTemplate = false,
) {
  const root = $getRoot();
  root.clear();
  let paragraph = $createParagraphNode();
  root.append(paragraph);
  const scenarioLabels = new Map((scenarioTags ?? []).map((item) => [item.id, item.label]));

  // Convert every leading `/skill ` token into a chip, not only the first.
  // Draft after multi-select looks like: `/init /playwright /review rest…`
  // Require a trailing space so an in-progress `/par` query stays plain text.
  while (true) {
    const slashMatch = value.match(/^\/([^\s/]+)\s(.*)$/s);
    if (!slashMatch?.[1]) break;
    paragraph.append($createComposerSlashCommandNode(slashMatch[1]));
    paragraph.append($createTextNode(" "));
    value = slashMatch[2] ?? "";
  }

  const segments = value.split(
    capabilityTemplate
      ? /(\[\[assistant-scenario:[^\]]+\]\]|@[^\s@<]+)/
      : /(\[\[assistant-scenario:[^\]]+\]\]|@[^\s@]+)/,
  );
  for (const segment of segments) {
    if (!segment) continue;
    const scenarioMatch = segment.match(/^\[\[assistant-scenario:([^\]]+)\]\]$/);
    if (scenarioMatch?.[1]) {
      const label = scenarioLabels.get(scenarioMatch[1]);
      if (label) {
        paragraph.append($createComposerScenarioNode(scenarioMatch[1], label));
        continue;
      }
    }
    if (segment.startsWith("@")) {
      const token = decodeComposerMentionValue(segment.slice(1));
      const kind = mentions[token];
      if (kind) {
        paragraph.append($createComposerMentionNode(token, kind));
        continue;
      }
    }
    paragraph = capabilityTemplate
      ? appendCapabilityTemplateSegment(paragraph, segment)
      : appendSegmentWithNewlines(paragraph, segment);
  }
}

// Serialize the current editor state to the external draft string. Lexical's
// root.getTextContent() joins element children with "\n\n" (its "text content
// mode" for the root node), which causes single newlines typed/pasted by the
// user to round-trip as double newlines and quickly corrupts the draft. We
// walk root children ourselves and join with a single "\n" so every newline
// the user sees onscreen is preserved exactly in the stored draft.
function serializePromptFromRoot(): string {
  const root = $getRoot();
  return root
    .getChildren()
    .map((child) => child.getTextContent())
    .join("\n");
}

function isLexicalComposing(editor: {
  isComposing?: () => boolean;
}): boolean {
  try {
    return typeof editor.isComposing === "function" ? editor.isComposing() : false;
  } catch {
    return false;
  }
}

function mentionsMapEqual(
  a: Record<string, ComposerMentionKind>,
  b: Record<string, ComposerMentionKind>,
): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function scenarioTagsEqual(
  a: Array<{ id: string; label: string }> | undefined,
  b: Array<{ id: string; label: string }> | undefined,
): boolean {
  if (a === b) return true;
  if (!a?.length && !b?.length) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.id !== b[i]?.id || a[i]?.label !== b[i]?.label) return false;
  }
  return true;
}

function SyncPlugin(props: {
  value: string;
  mentions: Record<string, ComposerMentionKind>;
  scenarioTags?: Array<{ id: string; label: string }>;
  disabled: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const valueRef = useRef(props.value);
  const mentionsRef = useRef(props.mentions);
  const scenarioTagsRef = useRef(props.scenarioTags);

  useEffect(() => {
    editor.setEditable(!props.disabled);
  }, [editor, props.disabled]);

  useEffect(() => {
    // Never rebuild the editor while IME composition is active — rewriting
    // the tree mid-composition doubles glyphs (especially CJK input).
    if (isLexicalComposing(editor)) return;

    // When the external value is cleared (e.g. after sending a message),
    // always force-rebuild the editor to remove any stale chip nodes.
    // The valueRef check can false-positive when both refs converge to ""
    // through different paths (SyncPlugin vs OnChange).
    //
    // Mentions/scenarioTags can land after the draft string (Ask Agent,
    // add-to-task). Draft text is identical (`@path …`) but without the
    // map @tokens stay plain text. Rebuild when map *content* changes so
    // chips materialize (compare by value, not object identity — identity
    // thrashing would force rebuilds on every keystroke and corrupt IME).
    //
    // NOTE: serializePromptFromRoot() calls $getRoot() which requires an
    // active editor state. Outside of editor.update()/editor.read() we
    // must wrap it in editor.getEditorState().read().
    const mentionsChanged = !mentionsMapEqual(mentionsRef.current, props.mentions);
    const scenarioTagsChanged = !scenarioTagsEqual(
      scenarioTagsRef.current,
      props.scenarioTags,
    );
    mentionsRef.current = props.mentions;
    scenarioTagsRef.current = props.scenarioTags;

    const currentText = editor.getEditorState().read(() => serializePromptFromRoot());
    const forceRebuild = !props.value.trim() && currentText.trim() !== "";
    const valueUnchanged = valueRef.current === props.value;
    if (!forceRebuild && valueUnchanged && !mentionsChanged && !scenarioTagsChanged) {
      return;
    }
    valueRef.current = props.value;
    // Check whether the editor already reflects the desired state BEFORE
    // entering editor.update(). Even a bail-out inside editor.update()
    // triggers Lexical's reconciliation cycle which can normalise the DOM
    // selection and reset the cursor (e.g. after a multi-line paste the
    // cursor jumps to position 0 instead of staying after the pasted
    // content). The read() above already gave us `currentText` — reuse it.
    // Skip this short-circuit when mentions/tags changed: serialized text
    // can match the draft while nodes are still plain @tokens.
    if (
      !forceRebuild &&
      !mentionsChanged &&
      !scenarioTagsChanged &&
      currentText === props.value
    ) {
      return;
    }
    editor.update(() => {
      // Double-check inside the update in case another queued update
      // changed the state between the read above and this callback.
      if (
        !forceRebuild &&
        !mentionsChanged &&
        !scenarioTagsChanged &&
        serializePromptFromRoot() === props.value
      ) {
        return;
      }
      setPrompt(props.value, props.mentions, props.scenarioTags);
      // $getRoot().selectEnd() doesn't work when the last node is a
      // token (chip) — Lexical can't position a cursor inside a token,
      // so the selection collapses to position 0. Use element-level
      // selection instead: place the cursor *after* the last child of
      // the last paragraph.
      const lastParagraph = $getRoot().getLastChild();
      if ($isElementNode(lastParagraph)) {
        const childCount = lastParagraph.getChildrenSize();
        lastParagraph.select(childCount, childCount);
      } else {
        $getRoot().selectEnd();
      }
    });
  }, [editor, props.mentions, props.scenarioTags, props.value]);

  return null;
}

function SubmitPlugin(props: { onSubmit: () => void | Promise<void>; disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  const onSubmitRef = useRef(props.onSubmit);

  useEffect(() => {
    onSubmitRef.current = props.onSubmit;
  }, [props.onSubmit]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (props.disabled) return false;
        // IME composition guard: three signals keep this reliable across
        // Chrome, Safari, and WebKit. While IME is mid-character, Enter
        // must always fall through to the editor so the composition can
        // commit.
        if (event?.isComposing === true || event?.keyCode === 229) return false;
        if (!event) return false;

        // Settings keymap: send vs insertNewline (Win-safe Shift+Enter only).
        const platform = detectKeymapPlatform();
        let overrides: Record<string, string> = {};
        try {
          const raw = window.localStorage.getItem("onmyagent.preferences");
          if (raw) {
            const parsed = JSON.parse(raw) as {
              keymapOverrides?: Record<string, string>;
            };
            overrides = parsed.keymapOverrides ?? {};
          }
        } catch {
          // ignore
        }
        const action = matchKeymapAction(event, overrides, platform);
        if (action === "insertNewline") {
          return false; // let Lexical insert newline
        }
        if (action === "sendMessage") {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          event.preventDefault();
          void onSubmitRef.current();
          return true;
        }

        // Legacy fallback if no keymap match (e.g. cleared bindings).
        if (event.shiftKey) return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        event.preventDefault();
        void onSubmitRef.current();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, props.disabled]);

  return null;
}

function ScenarioChipRemovePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const removeChip = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const slashButton = target.closest("button[data-slash-command-remove]");
      if (slashButton instanceof HTMLButtonElement) {
        const commandName = slashButton.dataset.slashCommandRemove;
        if (!commandName) return;
        event.preventDefault();
        event.stopPropagation();
        // createDOM nests the × inside the chip span — use that to pick the
        // exact chip when several skills share the same command name.
        const chipDom = slashButton.parentElement;
        editor.update(() => {
          const nodes = $getRoot()
            .getAllTextNodes()
            .filter(
              (node): node is ComposerSlashCommandNode =>
                node instanceof ComposerSlashCommandNode && node.__commandName === commandName,
            );
          const targetNode =
            (chipDom
              ? nodes.find((node) => editor.getElementByKey(node.getKey()) === chipDom)
              : null) ?? nodes[0];
          if (!targetNode) return;
          const next = targetNode.getNextSibling();
          targetNode.remove();
          // Drop the spacer text node right after the chip so chips stay tight.
          if ($isTextNode(next) && next.getTextContent().trim() === "") {
            next.remove();
          }
        });
        return;
      }

      const scenarioButton = target.closest("button[data-scenario-remove-id]");
      if (!(scenarioButton instanceof HTMLButtonElement)) return;
      const scenarioId = scenarioButton.dataset.scenarioRemoveId;
      if (!scenarioId) return;
      event.preventDefault();
      event.stopPropagation();
      editor.update(() => {
        for (const node of $getRoot().getAllTextNodes()) {
          if (node instanceof ComposerScenarioNode && node.__scenarioId === scenarioId) {
            node.remove();
          }
        }
      });
    };

    let currentRootElement: HTMLElement | null = null;
    const unregisterRootListener = editor.registerRootListener((rootElement, previousRootElement) => {
      if (previousRootElement) {
        previousRootElement.removeEventListener("mousedown", removeChip);
        previousRootElement.removeEventListener("click", removeChip);
      }
      currentRootElement = rootElement;
      if (!rootElement) return;
      rootElement.addEventListener("mousedown", removeChip);
      rootElement.addEventListener("click", removeChip);
    });
    return () => {
      if (currentRootElement) {
        currentRootElement.removeEventListener("mousedown", removeChip);
        currentRootElement.removeEventListener("click", removeChip);
      }
      unregisterRootListener();
    };
  }, [editor]);

  return null;
}

function ComposerTemplatePlugin(props: {
  sessionId: string;
  mentions: Record<string, ComposerMentionKind>;
  scenarioTags?: Array<{ id: string; label: string }>;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return registerCapabilitySlotEditing(editor);
  }, [editor]);

  useEffect(() => {
    const applyTemplate = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (
        !detail ||
        typeof detail !== "object" ||
        Array.isArray(detail) ||
        !("template" in detail) ||
        typeof detail.template !== "string" ||
        !detail.template.trim()
      ) {
        return;
      }
      const targetSessionId =
        "targetSessionId" in detail &&
        typeof detail.targetSessionId === "string"
          ? detail.targetSessionId
          : null;
      if (targetSessionId && targetSessionId !== props.sessionId) return;
      const template = detail.template;

      editor.update(
        () => {
          setPrompt(template, props.mentions, props.scenarioTags, true);
          const firstSlot = $nodesOfType(ComposerPlaceholderNode)[0];
          if (firstSlot) $selectComposerPlaceholderNode(firstSlot);
        },
        { onUpdate: () => editor.focus() },
      );
    };

    for (const eventName of COMPOSER_TEMPLATE_EVENTS) {
      window.addEventListener(eventName, applyTemplate);
    }
    return () => {
      for (const eventName of COMPOSER_TEMPLATE_EVENTS) {
        window.removeEventListener(eventName, applyTemplate);
      }
    };
  }, [editor, props.mentions, props.scenarioTags, props.sessionId]);

  useEffect(() => {
    const focusEmptySlot = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const placeholderDom = target.closest("[data-composer-placeholder]");
      if (!(placeholderDom instanceof HTMLElement)) return;
      if (!placeholderDom.dataset.slotPlaceholder) return;

      event.preventDefault();
      editor.update(
        () => {
          const placeholderNode = $nodesOfType(ComposerPlaceholderNode).find(
            (node) => editor.getElementByKey(node.getKey()) === placeholderDom,
          );
          if (placeholderNode) {
            $selectComposerPlaceholderNode(placeholderNode);
          }
        },
        { onUpdate: () => editor.focus() },
      );
    };

    let currentRootElement: HTMLElement | null = null;
    const unregisterRootListener = editor.registerRootListener(
      (rootElement, previousRootElement) => {
        previousRootElement?.removeEventListener(
          "mousedown",
          focusEmptySlot,
        );
        currentRootElement = rootElement;
        rootElement?.addEventListener("mousedown", focusEmptySlot);
      },
    );
    return () => {
      currentRootElement?.removeEventListener("mousedown", focusEmptySlot);
      unregisterRootListener();
    };
  }, [editor]);

  return null;
}

function MentionChipNavigationPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterBackspace = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const anchorNode = selection.anchor.getNode();

        // --- Slash command chip: atomic delete ---
        // When cursor is in the text node right after a slash chip,
        // remove the chip (and any trailing whitespace text) in one action.
        if ($isTextNode(anchorNode)) {
          const previous = anchorNode.getPreviousSibling();
          if (previous instanceof ComposerSlashCommandNode) {
            // At offset 0: cursor is right after the chip -> remove chip
            // At offset > 0 but text is only whitespace: also remove chip
            const textBefore = anchorNode.getTextContent().slice(0, selection.anchor.offset);
            if (selection.anchor.offset === 0 || textBefore.trim() === "") {
              previous.remove();
              // Also remove the whitespace-only prefix
              if (selection.anchor.offset > 0) {
                const remaining = anchorNode.getTextContent().slice(selection.anchor.offset);
                if (remaining) {
                  anchorNode.setTextContent(remaining);
                  const sel = $createRangeSelection();
                  sel.anchor.set(anchorNode.getKey(), 0, "text");
                  sel.focus.set(anchorNode.getKey(), 0, "text");
                  $setSelection(sel);
                } else {
                  anchorNode.remove();
                }
              }
              return true;
            }
          }
        }

        // --- Mention / scenario chips: atomic delete (same as before) ---
        if ($isTextNode(anchorNode) && selection.anchor.offset === 0) {
          const previous = anchorNode.getPreviousSibling();
          if (
            previous instanceof ComposerMentionNode ||
            previous instanceof ComposerScenarioNode
          ) {
            previous.remove();
            return true;
          }
        }

        if ($isElementNode(anchorNode)) {
          const previous = anchorNode.getChildAtIndex(selection.anchor.offset - 1);
          if (
            previous instanceof ComposerSlashCommandNode ||
            previous instanceof ComposerMentionNode ||
            previous instanceof ComposerScenarioNode
          ) {
            previous.remove();
            return true;
          }
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterLeft = editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const anchorNode = selection.anchor.getNode();

        if ($isTextNode(anchorNode) && selection.anchor.offset === 0) {
          const previous = anchorNode.getPreviousSibling();
          if (
            previous instanceof ComposerMentionNode ||
            previous instanceof ComposerSlashCommandNode ||
            previous instanceof ComposerScenarioNode
          ) {
            setSelectionBeforeNode(previous);
            return true;
          }
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const anchorNode = selection.anchor.getNode();

        if (
          anchorNode instanceof ComposerMentionNode ||
          anchorNode instanceof ComposerSlashCommandNode ||
          anchorNode instanceof ComposerScenarioNode
        ) {
          setSelectionAfterNode(anchorNode);
          return true;
        }

        if ($isElementNode(anchorNode)) {
          const current = anchorNode.getChildAtIndex(selection.anchor.offset);
          if (
            current instanceof ComposerMentionNode ||
            current instanceof ComposerSlashCommandNode ||
            current instanceof ComposerScenarioNode
          ) {
            setSelectionAfterNode(current);
            return true;
          }
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      unregisterBackspace();
      unregisterLeft();
      unregisterRight();
    };
  }, [editor]);

  return null;
}

export function LexicalPromptEditor(props: EditorProps) {
  const valueRef = useRef(props.value);
  const onChangeRef = useRef(props.onChange);

  useEffect(() => {
    valueRef.current = props.value;
  }, [props.value]);

  useEffect(() => {
    onChangeRef.current = props.onChange;
  }, [props.onChange]);

  const initialConfig = useMemo(
    () => ({
      namespace: "onmyagent-react-session-composer",
      onError(error: Error) {
        throw error;
      },
        editable: !props.disabled,
        nodes: [
          ComposerMentionNode,
          ComposerSlashCommandNode,
          ComposerScenarioNode,
          ComposerPlaceholderNode,
        ],
        editorState: () => {
          setPrompt(props.value, props.mentions, props.scenarioTags);
        },
      }),
    [],
  );

  const syncPromptFromEditorState = useCallback(
    (
      state: Parameters<NonNullable<React.ComponentProps<typeof OnChangePlugin>["onChange"]>>[0],
      editor?: { isComposing?: () => boolean },
    ) => {
      // Skip mid-IME updates so parent draft + SyncPlugin do not rewrite the
      // tree until composition commits (prevents doubled CJK/Latin glyphs).
      if (editor && isLexicalComposing(editor)) return;
      state.read(() => {
        const next = serializePromptFromRoot();
        if (next === valueRef.current) return;
        valueRef.current = next;
        onChangeRef.current(next);
      });
    },
    [],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      {/*
        Tight start, bounded growth:
        - min-h-16 matches in-session + expert empty.
        - hero (assistant new-task) uses a taller empty field under the brand title.
        - max-h caps long pastes so the transcript stays in view.
      */}
      <div className="relative">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              className={
                props.hero
                  ? "min-h-28 max-h-80 w-full resize-none overflow-y-auto bg-transparent text-composer text-dls-text outline-none placeholder:text-dls-secondary [&_p]:min-h-6 [&_p]:m-0"
                  : "min-h-16 max-h-72 w-full resize-none overflow-y-auto bg-transparent text-composer text-dls-text outline-none placeholder:text-dls-secondary [&_p]:min-h-6 [&_p]:m-0"
              }
              aria-placeholder={props.placeholder}
              placeholder={<span />}
              onPaste={props.onPaste}
              onDrop={props.onDrop}
              onDragOver={props.onDragOver}
              onDragLeave={props.onDragLeave}
            />
          }
          placeholder={
            <div className="pointer-events-none absolute left-0 top-0 text-composer text-dls-secondary/70">
              {props.placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin onChange={syncPromptFromEditorState} />
        <HistoryPlugin />
        <SyncPlugin value={props.value} mentions={props.mentions} scenarioTags={props.scenarioTags} disabled={props.disabled} />
        <SubmitPlugin onSubmit={props.onSubmit} disabled={props.disabled} />
        <ScenarioChipRemovePlugin />
        <ComposerTemplatePlugin
          sessionId={props.sessionId}
          mentions={props.mentions}
          scenarioTags={props.scenarioTags}
        />
        <MentionChipNavigationPlugin />
      </div>
    </LexicalComposer>
  );
}
