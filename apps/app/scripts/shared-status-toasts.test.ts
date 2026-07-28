import { describe, expect, test } from "bun:test";

import {
  mergeStatusToastStack,
  statusToastContentKey,
  statusToastDurationForTone,
  type AppStatusToast,
  type AppStatusToastInput,
  type AppStatusToastTone,
} from "../src/react-app/domains/shell-feedback/status-toasts";

describe("shared status toasts contract", () => {
  test("keeps warning and error toasts visible longer than neutral toasts", () => {
    const neutralTones: AppStatusToastTone[] = ["success", "info"];
    const urgentTones: AppStatusToastTone[] = ["warning", "error"];

    for (const tone of neutralTones) {
      expect(statusToastDurationForTone(tone)).toBe(3200);
    }
    for (const tone of urgentTones) {
      expect(statusToastDurationForTone(tone)).toBe(4200);
    }
  });

  test("supports optional action and dismiss metadata used across domains", () => {
    const input: AppStatusToastInput = {
      title: "Saved",
      description: "Changes are ready.",
      tone: "success",
      actionLabel: "Open",
      onAction: () => undefined,
      dismissLabel: "Close",
      durationMs: 0,
    };

    expect(input).toMatchObject({
      title: "Saved",
      description: "Changes are ready.",
      tone: "success",
      actionLabel: "Open",
      dismissLabel: "Close",
      durationMs: 0,
    });
  });

  test("content key ignores whitespace and defaults tone to info", () => {
    expect(
      statusToastContentKey({
        title: "  Hello  ",
        description: " world ",
        tone: "warning",
      }),
    ).toBe(statusToastContentKey({ title: "Hello", description: "world", tone: "warning" }));
    expect(statusToastContentKey({ title: "A" })).toBe(
      statusToastContentKey({ title: "A", tone: "info", description: "" }),
    );
  });

  test("mergeStatusToastStack dedupes identical content instead of stacking", () => {
    const first: AppStatusToast = {
      id: "t1",
      tone: "warning",
      title: "原模型已不可用",
      description: "Doubao Seed Evolving 已不在当前配置中",
    };
    const second: AppStatusToast = {
      id: "t2",
      tone: "warning",
      title: "原模型已不可用",
      description: "Doubao Seed Evolving 已不在当前配置中",
    };
    const merged = mergeStatusToastStack([first], second);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("t1");
    expect(merged[0]?.title).toBe(first.title);

    const other: AppStatusToast = {
      id: "t3",
      tone: "info",
      title: "Saved",
    };
    expect(mergeStatusToastStack(merged, other)).toHaveLength(2);
  });
});
