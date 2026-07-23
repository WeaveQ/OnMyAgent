import assert from "node:assert/strict";
import test from "node:test";

import {
  exportVisualSnapshot,
  normalizeVisualCaptureRect,
} from "./visual-snapshot-export.mjs";

test("normalizeVisualCaptureRect clamps capture to the current window", () => {
  assert.deepEqual(
    normalizeVisualCaptureRect(
      { x: -10, y: 20, width: 2_000, height: 900 },
      { width: 1_200, height: 800 },
    ),
    { x: 0, y: 20, width: 1_200, height: 780 },
  );
});

test("exportVisualSnapshot writes the selected PNG and reports cancellation", async () => {
  const writes = [];
  const sourceWindow = {
    isDestroyed: () => false,
    getContentBounds: () => ({ width: 1_000, height: 700 }),
    webContents: {
      capturePage: async () => ({
        isEmpty: () => false,
        toPNG: () => Buffer.from("png"),
      }),
    },
  };
  const saved = await exportVisualSnapshot(
    {
      format: "png",
      rect: { x: 10, y: 20, width: 300, height: 200 },
      defaultPath: "preview.png",
    },
    {
      sourceWindow,
      dialog: { showSaveDialog: async () => ({ canceled: false, filePath: "/tmp/preview.png" }) },
      writeFile: async (path, bytes) => writes.push([path, bytes.toString("utf8")]),
      createPdf: async () => Buffer.from("pdf"),
    },
  );
  assert.deepEqual(saved, { status: "saved", path: "/tmp/preview.png" });
  assert.deepEqual(writes, [["/tmp/preview.png", "png"]]);

  const cancelled = await exportVisualSnapshot(
    {
      format: "pdf",
      rect: { x: 0, y: 0, width: 100, height: 100 },
      defaultPath: "preview.pdf",
    },
    {
      sourceWindow,
      dialog: { showSaveDialog: async () => ({ canceled: true, filePath: undefined }) },
      writeFile: async () => undefined,
      createPdf: async () => Buffer.from("pdf"),
    },
  );
  assert.deepEqual(cancelled, { status: "cancelled", path: null });
});
