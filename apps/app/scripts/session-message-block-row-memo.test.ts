/**
 * P2: MessageBlockRow memo equality + per-block streaming isolation.
 * Imports shipped helpers — does not reimplement the row.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  blockIsActivelyStreaming,
  messageBlockRowPropsEqual,
  type MessageBlockRowMemoProps,
} from "../src/react-app/domains/session/surface/message-list/message-block-row-equality";
import type { MessageBlock } from "../src/react-app/domains/session/surface/message-list/types";

const appRoot = join(import.meta.dir, "..");

function fakeMessageBlock(id: string): MessageBlock {
  return {
    kind: "message",
    message: { id, role: "assistant", parts: [] } as MessageBlock["message"],
    renderableParts: [],
    attachments: [],
    groups: [],
    isUser: false,
    messageId: id,
  };
}

const sharedOnExpanded = () => undefined;
const sharedOnTurnDetails = () => undefined;
const sharedExpandedSteps = new Set<string>();

function baseProps(block: MessageBlock, overrides: Partial<MessageBlockRowMemoProps> = {}): MessageBlockRowMemoProps {
  return {
    block,
    blockIndex: 0,
    totalBlocks: 3,
    isNestedVariant: false,
    shouldUseContentVisibility: true,
    expandedStepIds: sharedExpandedSteps,
    isStreaming: false,
    latestAssistantMessageId: "m-live",
    showAssistantIdentity: false,
    turnDetailsExpanded: false,
    onExpandedStepIdsChange: sharedOnExpanded,
    onTurnDetailsExpandedChange: sharedOnTurnDetails,
    ...overrides,
  };
}

describe("blockIsActivelyStreaming (shipped)", () => {
  test("only the latest assistant message is actively streaming", () => {
    const live = fakeMessageBlock("m-live");
    const old = fakeMessageBlock("m-old");
    expect(blockIsActivelyStreaming(live, true, "m-live")).toBe(true);
    expect(blockIsActivelyStreaming(old, true, "m-live")).toBe(false);
    expect(blockIsActivelyStreaming(live, false, "m-live")).toBe(false);
  });

  test("step clusters stream only when they contain the live message id", () => {
    const cluster = {
      kind: "steps-cluster" as const,
      id: "c1",
      stepGroups: [],
      messageIds: ["m-a", "m-live"],
      isUser: false,
    };
    expect(blockIsActivelyStreaming(cluster, true, "m-live")).toBe(true);
    expect(blockIsActivelyStreaming(cluster, true, "m-other")).toBe(false);
  });
});

describe("messageBlockRowPropsEqual (shipped)", () => {
  test("equal when block pointer and scalar props match", () => {
    const block = fakeMessageBlock("m1");
    const a = baseProps(block);
    const b = baseProps(block);
    expect(messageBlockRowPropsEqual(a, b)).toBe(true);
  });

  test("unequal when block identity changes (new object) even with same messageId", () => {
    const a = baseProps(fakeMessageBlock("m1"));
    const b = baseProps(fakeMessageBlock("m1"));
    expect(a.block).not.toBe(b.block);
    expect(messageBlockRowPropsEqual(a, b)).toBe(false);
  });

  test("unequal when only isStreaming flips (tail row)", () => {
    const block = fakeMessageBlock("m-live");
    const a = baseProps(block, { isStreaming: false });
    const b = baseProps(block, { isStreaming: true });
    expect(messageBlockRowPropsEqual(a, b)).toBe(false);
  });

  test("equal when parent re-renders but reuses stabilized block and streaming false", () => {
    const block = fakeMessageBlock("m-old");
    const expanded = new Set<string>();
    const onExpanded = () => undefined;
    const a = baseProps(block, {
      isStreaming: false,
      expandedStepIds: expanded,
      onExpandedStepIdsChange: onExpanded,
    });
    const b = baseProps(block, {
      isStreaming: false,
      expandedStepIds: expanded,
      onExpandedStepIdsChange: onExpanded,
      // parent totalBlocks same; simulate unrelated surface churn with same props
      totalBlocks: 3,
    });
    expect(messageBlockRowPropsEqual(a, b)).toBe(true);
  });
});

describe("MessageBlockRow wiring (structural)", () => {
  test("row export is React.memo with custom equality; list passes blockIsActivelyStreaming", () => {
    const row = readFileSync(
      join(appRoot, "src/react-app/domains/session/surface/message-list/message-block-row.tsx"),
      "utf8",
    );
    const list = readFileSync(
      join(appRoot, "src/react-app/domains/session/surface/message-list.tsx"),
      "utf8",
    );
    expect(row).toContain("memo(MessageBlockRowInner, messageBlockRowPropsEqual)");
    expect(list).toContain("blockIsActivelyStreaming");
    expect(list).toContain("internalOnExpandedStepIdsChange");
    // SessionTranscript stays memo at the list boundary for surface isolation.
    expect(list).toContain("export const SessionTranscript = memo(SessionTranscriptInner)");
  });
});
