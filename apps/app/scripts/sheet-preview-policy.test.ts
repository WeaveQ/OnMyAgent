/**
 * Unit tests for shipped sheet-preview-policy (binary Office vs CSV routing).
 */
import { describe, expect, test } from "bun:test";

import {
  isBinarySpreadsheetPath,
  isTextSpreadsheetPath,
  shouldPreviewBinarySheetViaOfficeOverlay,
} from "../src/react-app/capabilities/artifacts/sheet-preview-policy";

describe("sheet-preview-policy (shipped)", () => {
  test("classifies binary Office workbooks vs delimited text sheets", () => {
    expect(isBinarySpreadsheetPath("report.xlsx")).toBe(true);
    expect(isBinarySpreadsheetPath("/ws/out/data.ods")).toBe(true);
    expect(isBinarySpreadsheetPath("legacy.xls")).toBe(true);
    expect(isBinarySpreadsheetPath("table.csv")).toBe(false);
    expect(isBinarySpreadsheetPath("table.tsv")).toBe(false);
    expect(isTextSpreadsheetPath("table.csv")).toBe(true);
    expect(isTextSpreadsheetPath("table.tsv")).toBe(true);
    expect(isTextSpreadsheetPath("table.xlsx")).toBe(false);
  });

  test("routes local binary sheets to Office overlay when absolute path exists", () => {
    expect(
      shouldPreviewBinarySheetViaOfficeOverlay({
        preview: "sheet",
        pathOrName: "报价.xlsx",
        isRemoteWorkspace: false,
        absoluteFilePath: "/Users/work/Documents/ws/报价.xlsx",
      }),
    ).toBe(true);

    expect(
      shouldPreviewBinarySheetViaOfficeOverlay({
        preview: "sheet",
        pathOrName: "output/data.xlsx",
        isRemoteWorkspace: false,
        absoluteFilePath: "C:\\Users\\me\\ws\\output\\data.xlsx",
      }),
    ).toBe(true);
  });

  test("does not use Office overlay for remote, text sheets, or missing absolute path", () => {
    expect(
      shouldPreviewBinarySheetViaOfficeOverlay({
        preview: "sheet",
        pathOrName: "报价.xlsx",
        isRemoteWorkspace: true,
        absoluteFilePath: "/Users/work/Documents/ws/报价.xlsx",
      }),
    ).toBe(false);

    expect(
      shouldPreviewBinarySheetViaOfficeOverlay({
        preview: "sheet",
        pathOrName: "rows.csv",
        isRemoteWorkspace: false,
        absoluteFilePath: "/Users/work/Documents/ws/rows.csv",
      }),
    ).toBe(false);

    expect(
      shouldPreviewBinarySheetViaOfficeOverlay({
        preview: "sheet",
        pathOrName: "报价.xlsx",
        isRemoteWorkspace: false,
        absoluteFilePath: "relative/only.xlsx",
      }),
    ).toBe(false);

    expect(
      shouldPreviewBinarySheetViaOfficeOverlay({
        preview: "markdown",
        pathOrName: "note.md",
        isRemoteWorkspace: false,
        absoluteFilePath: "/Users/work/Documents/ws/note.md",
      }),
    ).toBe(false);
  });
});
