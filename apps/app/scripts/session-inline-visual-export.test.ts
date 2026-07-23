import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  resolveVisualArtifactExport,
  visualExportFileName,
} from "../src/react-app/domains/session/surface/transcript/inline-visual-export";

describe("inline visual export", () => {
  test("offers the three user exports and no source-code action", () => {
    const source = readFileSync(
      new URL(
        "../src/react-app/domains/session/surface/transcript/inline-visual.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain('handleExport("png")');
    expect(source).toContain('handleExport("pdf")');
    expect(source).toContain('handleExport("xlsx")');
    expect(source).not.toContain("visual_show_source");
    expect(source).not.toContain("visual_hide_source");
  });

  test("uses the selected copy's real PDF and Excel artifacts", () => {
    const copies = [{
      key: "red",
      label: "二联收货单位（红）",
      pdf: "物流单_二联.pdf",
      xlsx: "物流单_二联.xlsx",
    }];

    expect(resolveVisualArtifactExport(copies, "red", "pdf")).toBe("物流单_二联.pdf");
    expect(resolveVisualArtifactExport(copies, "red", "xlsx")).toBe("物流单_二联.xlsx");
    expect(resolveVisualArtifactExport(copies, "white", "xlsx")).toBeNull();
  });

  test("builds safe export names for generated snapshots", () => {
    expect(visualExportFileName("两台注塑机 / 配载对比", "png")).toBe(
      "两台注塑机-配载对比.png",
    );
    expect(visualExportFileName(null, "pdf", "预览")).toBe("预览.pdf");
  });
});
