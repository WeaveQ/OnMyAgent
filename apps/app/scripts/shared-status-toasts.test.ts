import { describe, expect, test } from "bun:test";

import {
  statusToastDurationForTone,
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
});
