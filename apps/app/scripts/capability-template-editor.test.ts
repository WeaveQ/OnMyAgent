import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  createEditor,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
} from "lexical";
import {
  CAPABILITY_TEMPLATE_EVENT,
  COMPOSER_TEMPLATE_EVENT,
  splitCapabilityTemplate,
} from "../src/react-app/domains/session/surface/composer/capability-template";
import {
  $createComposerPlaceholderNode,
  $selectComposerPlaceholderNode,
  ComposerPlaceholderNode,
  normalizeCapabilitySlotText,
  registerCapabilitySlotEditing,
} from "../src/react-app/domains/session/surface/composer/capability-placeholder-node";

const appRoot = join(import.meta.dir, "..");
const repoRoot = join(appRoot, "../..");

function readApp(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

describe("capability template editor", () => {
  test("splits editable prose from every angle-bracket placeholder", () => {
    expect(
      splitCapabilityTemplate(
        "<出发地> 到 <目的地>，<吨> 吨 / <方> 方。",
      ),
    ).toEqual([
      { kind: "placeholder", value: "出发地" },
      { kind: "text", value: " 到 " },
      { kind: "placeholder", value: "目的地" },
      { kind: "text", value: "，" },
      { kind: "placeholder", value: "吨" },
      { kind: "text", value: " 吨 / " },
      { kind: "placeholder", value: "方" },
      { kind: "text", value: " 方。" },
    ]);
  });

  test("keeps @ prefixes and multiline prose while rejecting empty brackets", () => {
    expect(splitCapabilityTemplate("结合 @<车辆清单>\n再看 <>")).toEqual([
      { kind: "text", value: "结合 @" },
      { kind: "placeholder", value: "车辆清单" },
      { kind: "text", value: "\n再看 <>" },
    ]);
  });

  test("wires the capability event to an editable placeholder node", () => {
    const editor = readApp(
      "src/react-app/domains/session/surface/composer/editor.tsx",
    );
    const expert = readApp(
      "src/react-app/domains/session/pages/expert.tsx",
    );
    const visual = readApp(
      "src/react-app/domains/session/surface/transcript/inline-visual.tsx",
    );

    expect(CAPABILITY_TEMPLATE_EVENT).toBe("onmyagent-capability-template");
    expect(COMPOSER_TEMPLATE_EVENT).toBe("onmyagent-composer-template");
    expect(visual).toContain("dispatchComposerTemplate(template)");
    expect(expert).toContain(
      "window.addEventListener(eventName, handler)",
    );
    const placeholderNode = readApp(
      "src/react-app/domains/session/surface/composer/capability-placeholder-node.ts",
    );
    expect(placeholderNode).toContain(
      "class ComposerPlaceholderNode extends ElementNode",
    );
    expect(placeholderNode).toContain("dataset.composerPlaceholder");
    expect(placeholderNode).toContain('input.contentEditable = "true"');
    expect(placeholderNode).toContain("getDOMSlot(element)");
    expect(placeholderNode).toContain("createSlotSpacer()");
    expect(placeholderNode).toContain("dataset.slotPlaceholder");
    expect(placeholderNode).toContain("override canBeEmpty(): true");
    expect(placeholderNode).toContain("override isInline(): true");
    expect(placeholderNode).toContain("PASTE_COMMAND");
    expect(placeholderNode).toContain("KEY_TAB_COMMAND");
    expect(editor).toContain("splitCapabilityTemplate(segment)");
    expect(editor).toContain("<HistoryPlugin />");
    expect(editor).not.toContain("document.createTreeWalker");
  });

  test("normalizes multiline pasted values without changing ordinary text", () => {
    expect(normalizeCapabilitySlotText("上海")).toBe("上海");
    expect(normalizeCapabilitySlotText("上海\n  浦东\r\n新区")).toBe(
      "上海 浦东 新区",
    );
  });

  test("keeps empty slots in the document while exporting their placeholder", () => {
    const lexicalEditor = createEditor({
      namespace: "capability-template-test",
      nodes: [ComposerPlaceholderNode],
      onError(error) {
        throw error;
      },
    });
    registerCapabilitySlotEditing(lexicalEditor);

    lexicalEditor.update(
      () => {
        const paragraph = $createParagraphNode();
        const placeholder = $createComposerPlaceholderNode("出发地");
        paragraph.append(placeholder);
        paragraph.append($createComposerPlaceholderNode("目的地"));
        $getRoot().append(paragraph);
        $selectComposerPlaceholderNode(placeholder);
      },
      { discrete: true },
    );
    expect(
      lexicalEditor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("<出发地><目的地>");

    lexicalEditor.update(
      () => {
        expect(
          lexicalEditor.dispatchCommand(
            CONTROLLED_TEXT_INSERTION_COMMAND,
            "上海",
          ),
        ).toBe(true);
      },
      { discrete: true },
    );

    lexicalEditor.getEditorState().read(() => {
      expect($getRoot().getTextContent()).toBe("上海<目的地>");
      const slots = $nodesOfType(ComposerPlaceholderNode);
      expect(slots).toHaveLength(2);
      expect(slots[0]?.getSlotValue()).toBe("上海");
      expect(slots[1]?.getSlotValue()).toBe("");
    });
  });

  test("places a collapsed caret on the invisible anchor inside an empty slot", () => {
    const lexicalEditor = createEditor({
      namespace: "capability-template-caret-test",
      nodes: [ComposerPlaceholderNode],
      onError(error) {
        throw error;
      },
    });

    lexicalEditor.update(
      () => {
        const slot = $createComposerPlaceholderNode("时间");
        $getRoot().append($createParagraphNode().append(slot));
        $selectComposerPlaceholderNode(slot);
      },
      { discrete: true },
    );

    lexicalEditor.getEditorState().read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.isCollapsed()).toBe(true);
      const anchorNode = selection.anchor.getNode();
      expect($isTextNode(anchorNode)).toBe(true);
      expect(anchorNode.getParent()).toBeInstanceOf(ComposerPlaceholderNode);
      expect(selection.anchor.type).toBe("text");
      expect(selection.anchor.offset).toBe(1);
      expect($getRoot().getTextContent()).toBe("<时间>");
    });
  });

  test("restores the placeholder when a slot is cleared", () => {
    const lexicalEditor = createEditor({
      namespace: "capability-template-clear-test",
      nodes: [ComposerPlaceholderNode],
      onError(error) {
        throw error;
      },
    });

    lexicalEditor.update(
      () => {
        const slot = $createComposerPlaceholderNode("主题");
        slot.clear();
        slot.append($createTextNode("供应链管理"));
        $getRoot().append($createParagraphNode().append(slot));
      },
      { discrete: true },
    );
    expect(
      lexicalEditor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("供应链管理");

    lexicalEditor.update(
      () => {
        $nodesOfType(ComposerPlaceholderNode)[0]?.clear();
      },
      { discrete: true },
    );
    expect(
      lexicalEditor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("<主题>");
  });

  test("deletes an empty selected slot without deleting surrounding prose", () => {
    const lexicalEditor = createEditor({
      namespace: "capability-template-delete-test",
      nodes: [ComposerPlaceholderNode],
      onError(error) {
        throw error;
      },
    });
    registerCapabilitySlotEditing(lexicalEditor);
    let prevented = false;

    lexicalEditor.update(
      () => {
        const slot = $createComposerPlaceholderNode("时间");
        $getRoot().append(
          $createParagraphNode()
            .append($createTextNode("请填 "))
            .append(slot)
            .append($createTextNode("。")),
        );
        $selectComposerPlaceholderNode(slot);
        expect(
          lexicalEditor.dispatchCommand(KEY_BACKSPACE_COMMAND, {
            preventDefault() {
              prevented = true;
            },
          }),
        ).toBe(true);
      },
      { discrete: true },
    );

    expect(prevented).toBe(true);
    expect(
      lexicalEditor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("请填 。");
  });

  test("backspace after an empty slot removes only the slot", () => {
    const lexicalEditor = createEditor({
      namespace: "capability-template-backward-boundary-test",
      nodes: [ComposerPlaceholderNode],
      onError(error) {
        throw error;
      },
    });
    registerCapabilitySlotEditing(lexicalEditor);
    let prevented = false;

    lexicalEditor.update(
      () => {
        const followingText = $createTextNode(" 箱货物");
        $getRoot().append(
          $createParagraphNode()
            .append($createTextNode("发 "))
            .append($createComposerPlaceholderNode("数量"))
            .append(followingText),
        );
        followingText.select(0, 0);
        expect(
          lexicalEditor.dispatchCommand(KEY_BACKSPACE_COMMAND, {
            preventDefault() {
              prevented = true;
            },
          }),
        ).toBe(true);
      },
      { discrete: true },
    );

    expect(prevented).toBe(true);
    expect(
      lexicalEditor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("发  箱货物");
  });

  test("delete before an empty slot removes only the slot", () => {
    const lexicalEditor = createEditor({
      namespace: "capability-template-forward-boundary-test",
      nodes: [ComposerPlaceholderNode],
      onError(error) {
        throw error;
      },
    });
    registerCapabilitySlotEditing(lexicalEditor);
    let prevented = false;

    lexicalEditor.update(
      () => {
        const precedingText = $createTextNode("发 ");
        $getRoot().append(
          $createParagraphNode()
            .append(precedingText)
            .append($createComposerPlaceholderNode("数量"))
            .append($createTextNode(" 箱货物")),
        );
        const offset = precedingText.getTextContentSize();
        precedingText.select(offset, offset);
        expect(
          lexicalEditor.dispatchCommand(KEY_DELETE_COMMAND, {
            preventDefault() {
              prevented = true;
            },
          }),
        ).toBe(true);
      },
      { discrete: true },
    );

    expect(prevented).toBe(true);
    expect(
      lexicalEditor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("发  箱货物");
  });

  test("moves between slots with Tab and keeps each value independent", () => {
    const lexicalEditor = createEditor({
      namespace: "capability-template-tab-test",
      nodes: [ComposerPlaceholderNode],
      onError(error) {
        throw error;
      },
    });
    registerCapabilitySlotEditing(lexicalEditor);
    let prevented = false;

    lexicalEditor.update(
      () => {
        const first = $createComposerPlaceholderNode("出发地");
        $getRoot()
          .append(
            $createParagraphNode()
              .append(first)
              .append($createTextNode(" 到 "))
              .append($createComposerPlaceholderNode("目的地")),
          );
        $selectComposerPlaceholderNode(first);
        lexicalEditor.dispatchCommand(
          CONTROLLED_TEXT_INSERTION_COMMAND,
          "上海",
        );
        expect(
          lexicalEditor.dispatchCommand(KEY_TAB_COMMAND, {
            shiftKey: false,
            preventDefault() {
              prevented = true;
            },
          }),
        ).toBe(true);
        lexicalEditor.dispatchCommand(
          CONTROLLED_TEXT_INSERTION_COMMAND,
          "宁波",
        );
      },
      { discrete: true },
    );

    expect(prevented).toBe(true);
    expect(
      lexicalEditor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("上海 到 宁波");
  });

  test("pastes plain multiline text into only the focused empty slot", () => {
    const lexicalEditor = createEditor({
      namespace: "capability-template-paste-test",
      nodes: [ComposerPlaceholderNode],
      onError(error) {
        throw error;
      },
    });
    registerCapabilitySlotEditing(lexicalEditor);
    let prevented = false;

    lexicalEditor.update(
      () => {
        const first = $createComposerPlaceholderNode("货物");
        $getRoot()
          .append(
            $createParagraphNode()
              .append(first)
              .append($createTextNode("，数量 "))
              .append($createComposerPlaceholderNode("数量")),
          );
        $selectComposerPlaceholderNode(first);
        expect(
          lexicalEditor.dispatchCommand(PASTE_COMMAND, {
            clipboardData: {
              files: [],
              getData() {
                return "汽车配件\n  纸箱";
              },
            },
            preventDefault() {
              prevented = true;
            },
          }),
        ).toBe(true);
      },
      { discrete: true },
    );

    expect(prevented).toBe(true);
    expect(
      lexicalEditor.getEditorState().read(() => $getRoot().getTextContent()),
    ).toBe("汽车配件 纸箱，数量 <数量>");
  });

  test("all logistics efficiency templates keep two or three editable inputs", () => {
    const packages = [
      "order-dispatch-specialist",
      "fleet-management-specialist",
      "fulfillment-specialist",
      "logistics-finance-specialist",
    ];

    for (const packageName of packages) {
      const templates = JSON.parse(
        readFileSync(
          join(
            repoRoot,
            "apps/desktop/resources/marketplace/experts/plugins",
            packageName,
            "prompt-templates.json",
          ),
          "utf8",
        ),
      );
      expect(Array.isArray(templates)).toBe(true);
      if (!Array.isArray(templates)) continue;
      expect(templates).toHaveLength(4);
      for (const template of templates) {
        expect(template).toBeObject();
        if (
          !template ||
          typeof template !== "object" ||
          Array.isArray(template) ||
          !("template" in template) ||
          !template.template ||
          typeof template.template !== "object" ||
          Array.isArray(template.template) ||
          !("zh" in template.template) ||
          typeof template.template.zh !== "string"
        ) {
          continue;
        }
        expect(template.template.zh).toMatch(/<[^<>\r\n]+>/);
        const placeholders = template.template.zh.match(/<[^<>\r\n]+>/g) ?? [];
        expect(placeholders.length).toBeGreaterThanOrEqual(2);
        expect(placeholders.length).toBeLessThanOrEqual(3);
        expect([
          ...template.requiredSlots.zh,
          ...template.conditionalSlots.zh,
        ]).toHaveLength(placeholders.length);
      }
    }
  });
});
