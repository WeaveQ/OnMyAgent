import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  artifactPreviewInternals,
  createArtifactPreviewController,
} from "./artifact-preview-controller.mjs";

process.env.ONMYAGENT_ELECTRON_START_URL ??= "http://localhost:5173";

function createPreviewHarness(workspaceRoot) {
  const views = [];
  const openedPaths = [];
  const watchedPaths = [];
  const unwatchedPaths = [];
  const scheduled = [];
  let watchCallback = null;

  class FakeWebContentsView {
    constructor() {
      const listeners = new Map();
      this.bounds = null;
      this.webContents = {
        closed: false,
        sent: [],
        reloads: 0,
        close: () => { this.webContents.closed = true; },
        isDestroyed: () => this.webContents.closed,
        loadURL: async (url) => {
          this.webContents.url = url;
          listeners.get("did-finish-load")?.();
        },
        on: () => undefined,
        once: (name, callback) => listeners.set(name, callback),
        reloadIgnoringCache: async () => { this.webContents.reloads += 1; },
        send: (...args) => this.webContents.sent.push(args),
        setWindowOpenHandler: () => undefined,
      };
      views.push(this);
    }

    setBounds(bounds) { this.bounds = bounds; }
  }

  const contentView = {
    children: [],
    addChildView(view) { this.children.push(view); },
    removeChildView(view) { this.children = this.children.filter((child) => child !== view); },
  };
  const controller = createArtifactPreviewController({
    WebContentsView: FakeWebContentsView,
    listWorkspaceRoots: async () => [workspaceRoot],
    preloadPath: "/tmp/artifact-preview-preload.cjs",
    openPath: async (filePath) => { openedPaths.push(filePath); return ""; },
    watchFile: (filePath, _options, callback) => {
      watchedPaths.push(filePath);
      watchCallback = callback;
    },
    unwatchFile: (filePath) => unwatchedPaths.push(filePath),
    schedule: (callback) => { scheduled.push(callback); return callback; },
    cancelScheduled: (callback) => {
      const index = scheduled.indexOf(callback);
      if (index >= 0) scheduled.splice(index, 1);
    },
  });
  controller.setMainWindow({
    contentView,
    isDestroyed: () => false,
  });

  return {
    controller,
    openedPaths,
    scheduled,
    unwatchedPaths,
    views,
    watchedPaths,
    getWatchCallback: () => watchCallback,
    async flushScheduled() {
      while (scheduled.length > 0) await scheduled.shift()();
    },
  };
}

async function createTempWorkspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-preview-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

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

test("artifact preview native file list covers PDF, MP3, and MP4", () => {
  for (const extension of [".pdf", ".mp3", ".mp4"]) {
    assert.equal(artifactPreviewInternals.NATIVE_FILE_EXTENSIONS.has(extension), true);
  }
});

test("artifact preview loads MP3 and MP4 through local file URLs", async (t) => {
  const root = await createTempWorkspace(t);
  const harness = createPreviewHarness(root);

  for (const filename of ["meeting.mp3", "demo.mp4"]) {
    const filePath = path.join(root, filename);
    await writeFile(filePath, "media-bytes");
    assert.deepEqual(
      await harness.controller.show({
        filePath,
        bounds: { x: 0, y: 0, width: 600, height: 400 },
      }),
      { ok: true, kind: "media" },
    );
    assert.equal(
      harness.views.at(-1).webContents.url,
      pathToFileURL(await realpath(filePath)).href,
    );
    assert.deepEqual(harness.views.at(-1).webContents.sent, []);
  }
});

test("artifact preview opens only validated workspace files for editing", async (t) => {
  const root = await createTempWorkspace(t);
  const filePath = path.join(root, "report.docx");
  await writeFile(filePath, "first");
  const harness = createPreviewHarness(root);

  assert.deepEqual(await harness.controller.openForEditing({ filePath }), { ok: true });
  assert.deepEqual(harness.openedPaths, [await realpath(filePath)]);

  const outsideRoot = await createTempWorkspace(t);
  const outsidePath = path.join(outsideRoot, "outside.docx");
  await writeFile(outsidePath, "outside");
  await assert.rejects(
    harness.controller.openForEditing({ filePath: outsidePath }),
    /registered local workspaces/,
  );
});

test("artifact preview refreshes Office bytes after a stable file change", async (t) => {
  const root = await createTempWorkspace(t);
  const filePath = path.join(root, "report.docx");
  await writeFile(filePath, "first");
  const harness = createPreviewHarness(root);

  await harness.controller.show({
    filePath,
    bounds: { x: 0, y: 0, width: 600, height: 400 },
  });
  assert.deepEqual(harness.watchedPaths, [await realpath(filePath)]);

  await writeFile(filePath, "second-version");
  harness.getWatchCallback()(
    { mtimeMs: 2, size: 14 },
    { mtimeMs: 1, size: 5 },
  );
  await harness.flushScheduled();

  const payload = harness.views[0].webContents.sent.at(-1)[1];
  assert.equal(Buffer.from(payload.bytes).toString(), "second-version");
  assert.equal(payload.size, 14);
});

test("artifact preview reloads PDFs and debounces rapid save notifications", async (t) => {
  const root = await createTempWorkspace(t);
  const filePath = path.join(root, "report.pdf");
  await writeFile(filePath, "%PDF-first");
  const harness = createPreviewHarness(root);

  await harness.controller.show({
    filePath,
    bounds: { x: 0, y: 0, width: 600, height: 400 },
  });
  const notify = harness.getWatchCallback();
  notify({ mtimeMs: 2, size: 12 }, { mtimeMs: 1, size: 10 });
  notify({ mtimeMs: 3, size: 14 }, { mtimeMs: 2, size: 12 });
  assert.equal(harness.scheduled.length, 1);

  await writeFile(filePath, "%PDF-second");
  await harness.flushScheduled();
  assert.equal(harness.views[0].webContents.reloads, 1);
});

test("artifact preview replaces its watcher and disposes pending refresh work", async (t) => {
  const root = await createTempWorkspace(t);
  const firstPath = path.join(root, "first.docx");
  const secondPath = path.join(root, "second.xlsx");
  await writeFile(firstPath, "first");
  await writeFile(secondPath, "second");
  const harness = createPreviewHarness(root);

  await harness.controller.show({
    filePath: firstPath,
    bounds: { x: 0, y: 0, width: 600, height: 400 },
  });
  harness.getWatchCallback()({ mtimeMs: 2, size: 6 }, { mtimeMs: 1, size: 5 });
  await harness.controller.show({
    filePath: secondPath,
    bounds: { x: 0, y: 0, width: 600, height: 400 },
  });
  assert.deepEqual(harness.unwatchedPaths, [await realpath(firstPath)]);
  assert.equal(harness.scheduled.length, 0);

  harness.controller.destroy();
  assert.deepEqual(harness.unwatchedPaths, [await realpath(firstPath), await realpath(secondPath)]);
});
