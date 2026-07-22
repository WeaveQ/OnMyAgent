import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { artifactPreviewInternals } from "./artifact-preview-controller.mjs";

test("artifact preview path containment rejects siblings and traversal", () => {
  const root = path.resolve(path.sep, "workspaces", "alpha");
  assert.equal(artifactPreviewInternals.isWithinRoot(path.join(root, "report.docx"), root), true);
  assert.equal(artifactPreviewInternals.isWithinRoot(path.resolve(root, "..", "alpha-evil", "report.docx"), root), false);
  assert.equal(artifactPreviewInternals.isWithinRoot(path.resolve(root, "..", "secret.pdf"), root), false);
});

test("artifact preview bounds are finite non-negative integers", () => {
  assert.deepEqual(artifactPreviewInternals.safeBounds({ x: -4, y: 2.4, width: "30", height: Infinity }), {
    x: 0, y: 2, width: 30, height: 0,
  });
});

test("artifact preview renderer list covers Office families without PDF", () => {
  for (const extension of [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp"]) {
    assert.equal(artifactPreviewInternals.OFFICE_EXTENSIONS.has(extension), true);
  }
  assert.equal(artifactPreviewInternals.OFFICE_EXTENSIONS.has(".pdf"), false);
});
