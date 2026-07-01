import { describe, expect, test } from "bun:test";

import {
  formatSessionArchiveBytes,
  formatSessionArchiveCost,
  formatSessionArchiveDuration,
  formatSessionArchiveNumber,
  formatSessionArchivePercent,
  plainSessionArchiveSnippet,
  SESSION_ARCHIVE_ARCHIVE_MESSAGE_LIMIT,
  SESSION_ARCHIVE_ARCHIVE_PAGE_LIMIT,
  sessionArchiveImportStatsMessage,
  splitSessionArchiveLines,
} from "../src/react-app/domains/session/chat/session-page-session-archive-model";

describe("session page session archive model", () => {
  test("strips HTML snippets and normalizes line lists", () => {
    expect(plainSessionArchiveSnippet("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
    expect(splitSessionArchiveLines(" alpha \n\n beta\r\n  gamma  ")).toEqual(["alpha", "beta", "gamma"]);
  });

  test("formats numbers, costs, bytes, durations, and percents", () => {
    expect(formatSessionArchiveNumber(1234567)).toBe("1,234,567");
    expect(formatSessionArchiveCost(0)).toBe("$0.00");
    expect(formatSessionArchiveCost(0.00456)).toBe("$0.00456");
    expect(formatSessionArchiveCost(12.345)).toBe("$12.35");

    expect(formatSessionArchiveBytes(512)).toBe("512 B");
    expect(formatSessionArchiveBytes(1536)).toBe("1.5 KB");
    expect(formatSessionArchiveBytes(2 * 1024 * 1024)).toBe("2.0 MB");

    expect(formatSessionArchiveDuration(59_900)).toBe("59s");
    expect(formatSessionArchiveDuration(60_000)).toBe("1m");
    expect(formatSessionArchiveDuration(3_900_000)).toBe("1h 5m");

    expect(formatSessionArchivePercent(0.124)).toBe("12%");
    expect(formatSessionArchivePercent(0.995)).toBe("100%");
  });

  test("formats import stats with localized template", () => {
    expect(sessionArchiveImportStatsMessage({ imported: 3, updated: 2, skipped: 1, errors: 0 }))
      .toContain("3");
    expect(sessionArchiveImportStatsMessage({ imported: 3, updated: 2, skipped: 1, errors: 0 }))
      .toContain("2");
    expect(sessionArchiveImportStatsMessage({ imported: 3, updated: 2, skipped: 1, errors: 0 }))
      .toContain("1");
    expect(sessionArchiveImportStatsMessage({ imported: 3, updated: 2, skipped: 1, errors: 0 }))
      .toContain("0");
  });

  test("exports stable archive pagination limits", () => {
    expect(SESSION_ARCHIVE_ARCHIVE_PAGE_LIMIT).toBe(80);
    expect(SESSION_ARCHIVE_ARCHIVE_MESSAGE_LIMIT).toBe(500);
  });
});
