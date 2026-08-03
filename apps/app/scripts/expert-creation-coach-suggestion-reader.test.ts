import { describe, expect, test } from "bun:test";

import {
  waitForExpertCreationSuggestion,
} from "../src/react-app/domains/session/pages/expert-creation-coach-suggestion-reader";

function assistantMessage(
  id: string,
  text: string,
  completed = false,
) {
  return {
    info: {
      id,
      role: "assistant",
      time: {
        created: 1,
        ...(completed ? { completed: 2 } : {}),
      },
    },
    parts: [{ type: "text", text }],
  };
}

describe("expert creation coach suggestion reader", () => {
  test("waits for a new assistant message to complete before parsing its suggestion", async () => {
    let reads = 0;
    let sleeps = 0;
    const result = await waitForExpertCreationSuggestion({
      baselineAssistantMessageIds: new Set(["old-assistant"]),
      readMessages: async () => {
        reads += 1;
        if (reads === 1) {
          return [
            assistantMessage(
              "old-assistant",
              '<expert-update>{"name":"旧建议"}</expert-update>',
              true,
            ),
            assistantMessage(
              "new-assistant",
              '方案已生成。\n<expert-update>{"name":"中式美食专家","description":"提供家常菜建议"',
            ),
          ];
        }
        return [
          assistantMessage(
            "old-assistant",
            '<expert-update>{"name":"旧建议"}</expert-update>',
            true,
          ),
          assistantMessage(
            "new-assistant",
            '方案已生成。\n<expert-update>{"name":"中式美食专家","description":"提供家常菜建议"}</expert-update>',
            true,
          ),
        ];
      },
      sleep: async () => {
        sleeps += 1;
      },
      maxAttempts: 3,
    });

    expect(result).toEqual({
      messageId: "new-assistant",
      suggestion: {
        name: "中式美食专家",
        description: "提供家常菜建议",
      },
    });
    expect(reads).toBe(2);
    expect(sleeps).toBe(1);
  });
});
