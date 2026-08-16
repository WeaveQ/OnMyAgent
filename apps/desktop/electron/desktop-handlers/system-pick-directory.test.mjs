import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpenDirectoryDialogOptions,
  createSystemDomainHandlers,
  normalizeOpenDirectoryDialogResult,
} from "./system.mjs";

test("open-directory options always request a folder and keep defaultPath", () => {
  assert.deepEqual(buildOpenDirectoryDialogOptions({}), {
    properties: ["openDirectory", "createDirectory"],
  });
  assert.deepEqual(buildOpenDirectoryDialogOptions({}, { homedir: "/home/hope" }), {
    properties: ["openDirectory", "createDirectory"],
    defaultPath: "/home/hope",
  });
  assert.deepEqual(
    buildOpenDirectoryDialogOptions({
      title: "Choose workspace",
      defaultPath: "/home/hope/ws",
      multiple: true,
    }),
    {
      properties: ["openDirectory", "createDirectory", "multiSelections"],
      title: "Choose workspace",
      defaultPath: "/home/hope/ws",
    },
  );
  assert.deepEqual(
    buildOpenDirectoryDialogOptions({ title: "  ", defaultPath: "  " }),
    { properties: ["openDirectory", "createDirectory"] },
  );
});

test("empty or canceled folder picks are treated as canceled", () => {
  assert.equal(normalizeOpenDirectoryDialogResult({ canceled: true, filePaths: ["/tmp"] }), null);
  assert.equal(normalizeOpenDirectoryDialogResult({ canceled: false, filePaths: [] }), null);
  assert.equal(normalizeOpenDirectoryDialogResult({ canceled: false, filePaths: ["", "  "] }), null);
  assert.equal(normalizeOpenDirectoryDialogResult({ canceled: false, filePaths: ["/tmp/ws"] }), "/tmp/ws");
  assert.deepEqual(
    normalizeOpenDirectoryDialogResult(
      { canceled: false, filePaths: ["/a", "/b"] },
      { multiple: true },
    ),
    ["/a", "/b"],
  );
});

test("pickDirectory handler does not apply an empty GTK first selection", async () => {
  const shown = [];
  const handlers = createSystemDomainHandlers({
    dialog: {
      showOpenDialog: async (_window, options) => {
        shown.push(options);
        return { canceled: false, filePaths: [""] };
      },
    },
    activeWindowFromEvent: () => ({ id: 1 }),
  });
  const picked = await handlers.pickDirectory({}, [{ defaultPath: "/home/hope" }]);
  assert.equal(picked, null);
  assert.deepEqual(shown, [
    {
      properties: ["openDirectory", "createDirectory"],
      defaultPath: "/home/hope",
    },
  ]);
});
