import { describe, expect, test } from "bun:test";

import {
  computeTranscriptMaxContentWidth,
  DEFAULT_TRANSCRIPT_MAX_CONTENT_WIDTH,
  formatTranscriptDuration,
  formatTranscriptMessageTime,
} from "../src/react-app/domains/session/surface/transcript-presentation";

describe("session transcript presentation", () => {
  test("matches WorkBuddy responsive content widths", () => {
    expect(computeTranscriptMaxContentWidth(900)).toBe(DEFAULT_TRANSCRIPT_MAX_CONTENT_WIDTH);
    expect(computeTranscriptMaxContentWidth(1_200)).toBe(832);
    expect(computeTranscriptMaxContentWidth(1_280)).toBe(832);
    expect(computeTranscriptMaxContentWidth(1_600)).toBe(1_040);
    expect(computeTranscriptMaxContentWidth(2_000)).toBe(1_200);
    expect(computeTranscriptMaxContentWidth(2_400)).toBe(1_320);
    expect(computeTranscriptMaxContentWidth(3_000)).toBe(1_400);
  });

  test("matches WorkBuddy duration floors and units", () => {
    expect(formatTranscriptDuration(-1)).toBe("0s");
    expect(formatTranscriptDuration(999)).toBe("0s");
    expect(formatTranscriptDuration(45_999)).toBe("45s");
    expect(formatTranscriptDuration(393_999)).toBe("6m33s");
    expect(formatTranscriptDuration(4_999_999)).toBe("1h23m");
  });

  test("formats today, yesterday, current-year, and prior-year times", () => {
    const now = new Date(2026, 6, 15, 12, 0);
    const options = { locale: "zh-CN", now, yesterdayLabel: "昨天" };

    expect(formatTranscriptMessageTime(new Date(2026, 6, 15, 9, 5).getTime(), options)).toBe("09:05");
    expect(formatTranscriptMessageTime(new Date(2026, 6, 14, 9, 5).getTime(), options)).toBe("昨天 09:05");
    expect(formatTranscriptMessageTime(new Date(2026, 5, 3, 9, 5).getTime(), options)).toBe("6月3日 09:05");
    expect(formatTranscriptMessageTime(new Date(2025, 5, 3, 9, 5).getTime(), options)).toBe("2025年6月3日 09:05");
    expect(formatTranscriptMessageTime(null, options)).toBeNull();
    expect(formatTranscriptMessageTime(Number.NaN, options)).toBeNull();
  });
});
