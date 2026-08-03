import { describe, expect, test } from "bun:test";

import {
  buildExpertChatPromptParts,
  mergeExpertChatAttachments,
} from "../src/react-app/domains/agents/expert-creation-chat-attachments";

describe("expert creation chat attachments", () => {
  test("builds text and data-url file prompt parts", async () => {
    const parts = await buildExpertChatPromptParts(" Review this ", [
      new File(["hello"], "notes.txt", { type: "text/plain" }),
    ]);

    expect(parts).toEqual([
      { type: "text", text: "Review this" },
      {
        type: "file",
        mime: "text/plain;charset=utf-8",
        filename: "notes.txt",
        url: "data:text/plain;charset=utf-8;base64,aGVsbG8=",
      },
    ]);
  });

  test("supports attachment-only turns", async () => {
    const parts = await buildExpertChatPromptParts("", [new File(["x"], "context.bin")]);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.type).toBe("file");
  });

  test("deduplicates repeated file selections without dropping new files", () => {
    const first = new File(["x"], "notes.txt", { type: "text/plain", lastModified: 10 });
    const duplicate = new File(["x"], "notes.txt", { type: "text/plain", lastModified: 10 });
    const second = new File(["y"], "brief.txt", { type: "text/plain", lastModified: 20 });

    expect(mergeExpertChatAttachments([first], [duplicate, second])).toEqual([duplicate, second]);
  });
});
