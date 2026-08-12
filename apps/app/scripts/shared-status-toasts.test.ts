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

  test("mergeStatusToastStack replaces same-tag toasts in place with stable id", () => {
    const first: AppStatusToast = {
      id: "progress-1",
      tag: "updater-download:0.4.25",
      tone: "info",
      title: "Downloading OnMyAgent v0.4.25",
      description: "… 10%",
    };
    const second: AppStatusToast = {
      id: "progress-2",
      tag: "updater-download:0.4.25",
      tone: "info",
      title: "Downloading OnMyAgent v0.4.25",
      description: "… 55%",
    };
    const merged = mergeStatusToastStack([first], second);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("progress-1");
    expect(merged[0]?.description).toBe("… 55%");
    expect(merged[0]?.tag).toBe("updater-download:0.4.25");
  });

  test("tagged toasts do not content-dedupe against untagged toasts", () => {
    const tagged: AppStatusToast = {
      id: "t-tag",
      tag: "updater-download:0.4.25",
      tone: "info",
      title: "Downloading OnMyAgent v0.4.25",
      description: "… 10%",
    };
    const untagged: AppStatusToast = {
      id: "t-plain",
      tone: "info",
      title: "Downloading OnMyAgent v0.4.25",
      description: "… 10%",
    };
    // Untagged incoming must not replace a tagged toast with the same copy.
    const withUntagged = mergeStatusToastStack([tagged], untagged);
    expect(withUntagged).toHaveLength(2);

    // Tagged incoming replaces only the same tag, not an untagged twin.
    const otherTag: AppStatusToast = {
      id: "t-other",
      tag: "updater-download:0.4.26",
      tone: "info",
      title: "Downloading OnMyAgent v0.4.26",
      description: "… 1%",
    };
    const withOtherTag = mergeStatusToastStack([tagged], otherTag);
    expect(withOtherTag).toHaveLength(2);
    expect(withOtherTag.map((t) => t.tag).sort()).toEqual([
      "updater-download:0.4.25",
      "updater-download:0.4.26",
    ]);
  });
});
