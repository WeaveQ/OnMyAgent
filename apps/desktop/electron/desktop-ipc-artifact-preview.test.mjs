import assert from "node:assert/strict";
import test from "node:test";

import { registerDesktopArtifactPreviewIpc } from "./desktop-ipc-artifact-preview.mjs";

test("artifact preview IPC forwards validated edit requests to the controller", async () => {
  const handlers = new Map();
  const requests = [];
  registerDesktopArtifactPreviewIpc({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      on() {},
    },
    artifactPreviewController: {
      openForEditing: async (request) => {
        requests.push(request);
        return { ok: true };
      },
      hide() {},
      setBounds() {},
      show() {},
    },
  });

  const handler = handlers.get("onmyagent:artifact-preview:openForEditing");
  assert.equal(typeof handler, "function");
  assert.deepEqual(await handler({}, { filePath: "/workspace/report.docx" }), { ok: true });
  assert.deepEqual(requests, [{ filePath: "/workspace/report.docx" }]);
});
