import { describe, expect, test } from "bun:test";

import {
  canEditArtifactTarget,
  openArtifactForEditing,
} from "../src/react-app/capabilities/artifacts/open-artifact-for-editing";

describe("openArtifactForEditing", () => {
  test("offers system editing for Office and PDF previews only", () => {
    for (const target of [
      { preview: "document", name: "report.docx" },
      { preview: "sheet", name: "budget.xlsx" },
      { preview: "presentation", name: "brief.pptx" },
      { preview: "pdf", name: "contract.pdf" },
    ] as const) {
      expect(canEditArtifactTarget(target)).toBe(true);
    }
    expect(canEditArtifactTarget({ preview: "sheet", name: "data.csv" })).toBe(false);
    expect(canEditArtifactTarget({ preview: "sheet", name: "sheet.numbers" })).toBe(false);
    expect(canEditArtifactTarget({ preview: "presentation", name: "slides.key" })).toBe(false);
    expect(canEditArtifactTarget({ preview: "pdf", name: "scan.ofd" })).toBe(false);
    expect(canEditArtifactTarget({ preview: "markdown", name: "notes.md" })).toBe(false);
  });

  test("forwards the absolute path through the artifact preview bridge", async () => {
    const requests: Array<{ filePath: string }> = [];
    await openArtifactForEditing("/workspace/report.docx", {
      openForEditing: async (request) => {
        requests.push(request);
        return { ok: true };
      },
    });
    expect(requests).toEqual([{ filePath: "/workspace/report.docx" }]);
  });

  test("rejects when the desktop editing bridge is unavailable", async () => {
    await expect(openArtifactForEditing("/workspace/report.docx", {})).rejects.toThrow(
      "Artifact editing is unavailable",
    );
  });

  test("rejects unsuccessful desktop responses", async () => {
    await expect(
      openArtifactForEditing("/workspace/report.docx", {
        openForEditing: async () => ({ ok: false }),
      }),
    ).rejects.toThrow("Artifact editing failed");
  });
});
