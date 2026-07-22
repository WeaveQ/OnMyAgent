import { describe, expect, test } from "bun:test";

import { openArtifactForEditing } from "../src/react-app/capabilities/artifacts/open-artifact-for-editing";

describe("openArtifactForEditing", () => {
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
