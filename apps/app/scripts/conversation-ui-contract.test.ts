import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const conversationRoot = join(
  import.meta.dir,
  "../src/react-app/capabilities/conversation",
);
const uiRoot = join(conversationRoot, "ui");

function read(rel: string) {
  return readFileSync(join(conversationRoot, rel), "utf8");
}

describe("conversation shared UI contract", () => {
  test("ui/ directory exports shared presentational components", () => {
    const files = readdirSync(uiRoot).sort();
    expect(files).toContain("tool-item-row.tsx");
    expect(files).toContain("thinking-block.tsx");
    expect(files).toContain("approval-card.tsx");
    expect(files).toContain("plan-block.tsx");
    expect(files).toContain("conversation-item-view.tsx");
    expect(files).toContain("index.ts");

    for (const name of [
      "tool-item-row.tsx",
      "thinking-block.tsx",
      "approval-card.tsx",
      "plan-block.tsx",
      "conversation-item-view.tsx",
    ]) {
      expect(statSync(join(uiRoot, name)).isFile()).toBe(true);
    }
  });

  test("ConversationItemView switches on item.kind", () => {
    const source = read("ui/conversation-item-view.tsx");
    expect(source).toContain("export function ConversationItemView");
    expect(source).toContain("switch (item.kind)");
    expect(source).toContain('case "tool"');
    expect(source).toContain('case "thinking"');
    expect(source).toContain('case "plan"');
    expect(source).toContain('case "approval"');
    expect(source).toContain("ToolItemRow");
    expect(source).toContain("ThinkingBlock");
    expect(source).toContain("PlanBlock");
    expect(source).toContain("ApprovalCard");
  });

  test("barrel re-exports UI components and adapter helpers", () => {
    const barrel = read("index.ts");
    expect(barrel).toContain("ConversationItemView");
    expect(barrel).toContain("ToolItemRow");
    expect(barrel).toContain("ThinkingBlock");
    expect(barrel).toContain("ApprovalCard");
    expect(barrel).toContain("PlanBlock");
    expect(barrel).toContain("mapOpenCodeToolPartToItem");
    expect(barrel).toContain("mapOpenCodeReasoningPartToItem");
    expect(barrel).toContain("personalMessagesToConversationItems");
  });

  test("ConversationItemVM carries structured optional tool/thinking/approval fields", () => {
    const source = read("item-types.ts");
    expect(source).toContain("toolName?:");
    expect(source).toContain("toolStatus?:");
    expect(source).toContain("thinkingStatus?:");
    expect(source).toContain("approvalId?:");
    expect(source).toContain("meta?:");
  });

  test("ConversationItemsList renders via ConversationItemView", () => {
    const source = read("conversation-items-list.tsx");
    expect(source).toContain("ConversationItemView");
    expect(source).toContain("items.map");
  });

  test("component source files export named components", () => {
    expect(read("ui/tool-item-row.tsx")).toContain("export function ToolItemRow");
    expect(read("ui/thinking-block.tsx")).toContain("export function ThinkingBlock");
    expect(read("ui/approval-card.tsx")).toContain("export function ApprovalCard");
    expect(read("ui/plan-block.tsx")).toContain("export function PlanBlock");
  });
});
