import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  createComputerUseDesktopHelpers,
  parseComputerUseActivity,
  parseComputerUseStatus,
  resolveOnMyAgentProductVersion,
  sanitizeAppshotFileName,
  isComputerUseAppshotSupported,
} from "./computer-use-desktop.mjs";
import { isMostlyBlackNativeImage } from "./computer-use-appshot.mjs";

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  /** @type {number | null} */
  exitCode = null;
  /** @type {string[]} */
  killSignals = [];

  kill(signal = "SIGTERM") {
    this.killSignals.push(signal);
    this.exitCode = 0;
    this.emit("exit", 0, signal);
  }
}

test("resolveOnMyAgentProductVersion prefers product version over Electron runtime version", () => {
  assert.equal(
    resolveOnMyAgentProductVersion({ getVersion: () => "0.4.16" }),
    "0.4.16",
  );
});

test("getComputerUseMcpCommand on win32 uses staged Cua via runtime resolve", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-cua-cmd-"));
  try {
    const exe = path.join(root, "resources/helpers/cua/cua-driver.exe");
    await mkdir(path.dirname(exe), { recursive: true });
    await writeFile(exe, "driver");
    const helpers = createComputerUseDesktopHelpers({
      app: {
        getVersion: () => "0.4.16",
        isPackaged: true,
        getPath: () => root,
      },
      shell: {},
      dialog: {},
      systemPreferences: {},
      // dirname is electron/ — desktop root is parent
      dirname: path.join(root, "electron"),
    });
    // Point desktop root layout: helpers expects dirname/../resources
    await mkdir(path.join(root, "electron"), { recursive: true });
    // Re-stage under electron/../resources = root/resources (already written)
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const cmd = helpers.getComputerUseMcpCommand();
      assert.ok(Array.isArray(cmd));
      assert.equal(cmd[0], "cmd.exe");
      assert.ok(cmd.some((p) => String(p).includes("cua-driver.exe")));
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parseComputerUseStatus preserves permission, version, activity, Skysight, and app authorization state", () => {
  const parsed = parseComputerUseStatus(
    JSON.stringify({
      ok: true,
      accessibility: true,
      screenRecording: true,
      helperVersion: "1.2.3",
      protocolVersion: 2,
      activity: { phase: "running", app: "Safari" },
      skysight: { enabled: true, retentionDays: 30 },
      appAuthorizations: { allowedBundleIdentifiers: ["com.apple.Safari"] },
    }),
  );
  assert.deepEqual(parsed, {
    ok: true,
    accessibility: true,
    screenRecording: true,
    helperVersion: "1.2.3",
    protocolVersion: 2,
    activity: { phase: "running", app: "Safari" },
    skysight: { enabled: true, retentionDays: 30 },
    appAuthorizations: { allowedBundleIdentifiers: ["com.apple.Safari"] },
  });
});

test("authorization helpers revoke one app or clear all and return fresh status", async () => {
  const spawned = [];
  const spawnProcess = (_bin, args) => {
    spawned.push(args);
    const child = new FakeChildProcess();
    queueMicrotask(() => {
      if (args[0] === "--status") {
        child.stdout.write(
          `${JSON.stringify({
            ok: true,
            accessibility: true,
            screenRecording: true,
            appAuthorizations: { allowedBundleIdentifiers: [] },
          })}\n`,
        );
        child.stdout.end();
      }
      child.exitCode = 0;
      child.emit("close", 0);
    });
    return child;
  };
  const helpers = createComputerUseDesktopHelpers({
    app: { getVersion: () => "0.1.0", isPackaged: false },
    shell: {},
    dialog: {},
    systemPreferences: {},
    dirname: "/tmp/onmyagent/electron",
    spawnProcess,
    resolveComputerUseExecutable: () => "/fake/ComputerUse",
  });
  await helpers.revokeComputerUseAppAuthorization("com.apple.Notes");
  await helpers.clearComputerUseAppAuthorizations();
  assert.equal(
    spawned.some((args) => args.join(" ") === "authorization revoke com.apple.Notes"),
    true,
  );
  assert.equal(
    spawned.some((args) => args.join(" ") === "authorization clear"),
    true,
  );
});

test("parseComputerUseStatus rejects malformed helper output", () => {
  assert.equal(parseComputerUseStatus("{"), null);
  assert.equal(parseComputerUseStatus(JSON.stringify({ ok: true })), null);
});

test("parseComputerUseActivity accepts only known runtime phases", () => {
  assert.deepEqual(parseComputerUseActivity({ phase: "ready" }), {
    phase: "ready",
  });
  assert.deepEqual(
    parseComputerUseActivity({
      phase: "paused",
      app: "Safari",
      reason: "physical_input",
    }),
    {
      phase: "paused",
      app: "Safari",
      reason: "physical_input",
    },
  );
  assert.equal(parseComputerUseActivity({ phase: "unknown" }), null);
});

test("Skysight restore starts one managed recorder and dispose terminates it", async () => {
  const spawned = [];
  const recorder = new FakeChildProcess();

  const spawnProcess = (_bin, args) => {
    spawned.push(args);
    if (args[0] === "skysight" && args[1] === "record") return recorder;
    const child = new FakeChildProcess();
    queueMicrotask(() => {
      if (args[0] === "--status") {
        child.stdout.write(
          `${JSON.stringify({
            ok: true,
            accessibility: true,
            screenRecording: true,
            skysight: { enabled: true, retentionDays: 30 },
          })}\n`,
        );
        child.stdout.end();
      }
      child.exitCode = 0;
      child.emit("close", 0);
    });
    return child;
  };

  const helpers = createComputerUseDesktopHelpers({
    app: { getVersion: () => "0.1.0", isPackaged: false },
    shell: {},
    dialog: {},
    systemPreferences: {},
    dirname: "/tmp/onmyagent/electron",
    spawnProcess,
    resolveComputerUseExecutable: () => "/fake/ComputerUse",
  });

  await helpers.restoreComputerUseServices();
  await helpers.restoreComputerUseServices();
  const status = await helpers.checkComputerUsePermissions();

  assert.equal(spawned.filter((args) => args.join(" ") === "skysight record").length, 1);
  assert.equal(status.skysight.recording, true);
  helpers.disposeComputerUseServices();
  assert.deepEqual(recorder.killSignals, ["SIGTERM"]);
});

test("Skysight helpers pause, resume, and update exclusions", async () => {
  const spawned = [];
  const spawnProcess = (_bin, args) => {
    spawned.push(args);
    const child = new FakeChildProcess();
    queueMicrotask(() => {
      if (args[0] === "--status") {
        child.stdout.write(
          `${JSON.stringify({
            ok: true,
            accessibility: true,
            screenRecording: true,
            skysight: {
              enabled: true,
              paused: args[1] === "pause",
              retentionDays: 30,
            },
          })}\n`,
        );
        child.stdout.end();
      }
      child.exitCode = 0;
      child.emit("close", 0);
    });
    return child;
  };
  const helpers = createComputerUseDesktopHelpers({
    app: { getVersion: () => "0.1.0", isPackaged: false },
    shell: {},
    dialog: {},
    systemPreferences: {},
    dirname: "/tmp/onmyagent/electron",
    spawnProcess,
    resolveComputerUseExecutable: () => "/fake/ComputerUse",
  });
  await helpers.setComputerUseSkysightPaused(true);
  await helpers.setComputerUseSkysightPaused(false);
  await helpers.updateComputerUseSkysightExclusion("add", "website", "example.com");
  await helpers.updateComputerUseSkysightExclusion("remove", "private_browsing");
  assert.equal(spawned.some((args) => args.join(" ") === "skysight pause"), true);
  assert.equal(spawned.some((args) => args.join(" ") === "skysight resume"), true);
  assert.equal(
    spawned.some((args) => args.join(" ") === "skysight exclude add website example.com"),
    true,
  );
  assert.equal(
    spawned.some((args) => args.join(" ") === "skysight exclude remove private_browsing"),
    true,
  );
});

test("Appshot black-frame check treats sRGB toBitmap dark vs bright consistently", () => {
  const dark = {
    isEmpty: () => false,
    resize: () => ({
      toBitmap: () => Buffer.alloc(32 * 32 * 4, 0),
    }),
  };
  const bright = {
    isEmpty: () => false,
    resize: () => ({
      toBitmap: () => Buffer.alloc(32 * 32 * 4, 180),
    }),
  };
  assert.equal(isMostlyBlackNativeImage(dark), true);
  assert.equal(isMostlyBlackNativeImage(bright), false);
});

test("Appshot is supported on macOS and Windows", () => {
  assert.equal(isComputerUseAppshotSupported("darwin"), true);
  assert.equal(isComputerUseAppshotSupported("win32"), true);
  assert.equal(isComputerUseAppshotSupported("android"), false);
});

test("Appshot capture uses Electron desktopCapturer", async () => {
  const jpeg = Buffer.alloc(12_000, 0x80);
  const nativeImage = {
    isEmpty: () => false,
    resize: () => ({
      toBitmap: () => Buffer.alloc(32 * 32 * 4, 180),
    }),
    toJPEG: () => jpeg,
  };
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  const helpers = createComputerUseDesktopHelpers({
    app: { getVersion: () => "0.1.0", isPackaged: false, getName: () => "OnMyAgent" },
    shell: {},
    dialog: {},
    systemPreferences: { getMediaAccessStatus: () => "granted" },
    dirname: "/tmp/onmyagent/electron",
    desktopCapturer: {
      getSources: async () => [{ name: "Entire Screen", thumbnail: nativeImage }],
    },
    screen: {
      getPrimaryDisplay: () => ({
        id: 1,
        size: { width: 1280, height: 720 },
        scaleFactor: 2,
      }),
    },
    writeFile: (p, data) => {
      files.set(String(p), Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
    },
    readFile: (p) => {
      const hit = files.get(String(p));
      if (!hit) throw new Error(`missing ${p}`);
      return hit;
    },
  });
  const result = await helpers.captureComputerUseAppshot();
  assert.equal(result.mimeType, "image/jpeg");
  assert.match(result.name, /^Appshot-.*-Desktop\.jpg$/);
  assert.equal(result.data, jpeg.toString("base64"));
});

test("Appshot capture fails clearly when desktopCapturer returns black", async () => {
  const blackThumb = {
    isEmpty: () => false,
    resize: () => ({
      toBitmap: () => Buffer.alloc(32 * 32 * 4, 0),
    }),
    toJPEG: () => Buffer.alloc(100, 0),
  };
  const helpers = createComputerUseDesktopHelpers({
    app: { getVersion: () => "0.1.0", isPackaged: false, getName: () => "OnMyAgent" },
    shell: {},
    dialog: {},
    systemPreferences: { getMediaAccessStatus: () => "granted" },
    dirname: "/tmp/onmyagent/electron",
    desktopCapturer: {
      getSources: async () => [{ name: "Entire Screen", thumbnail: blackThumb }],
    },
    screen: {
      getPrimaryDisplay: () => ({ id: 1, size: { width: 800, height: 600 }, scaleFactor: 1 }),
    },
  });
  await assert.rejects(
    () => helpers.captureComputerUseAppshot(),
    /black image|Screen Recording/i,
  );
});

test("Appshot capture fails when desktopCapturer is missing", async () => {
  const helpers = createComputerUseDesktopHelpers({
    app: { getVersion: () => "0.1.0", isPackaged: false },
    shell: {},
    dialog: {},
    systemPreferences: {},
    dirname: "/tmp/onmyagent/electron",
  });
  await assert.rejects(
    () => helpers.captureComputerUseAppshot(),
    /not available/i,
  );
});

test("sanitizeAppshotFileName strips Swift JoinedSequence dumps", () => {
  const garbage =
    'Appshot-20260720-JoinedSequence<Array<ArraySlice<Character>>>(_base: [ArraySlice(["O"])], _separator: ContiguousArray(["-"])).jpg';
  const safe = sanitizeAppshotFileName(garbage, { platform: "darwin", now: 0 });
  assert.equal(safe.includes("JoinedSequence"), false);
  assert.match(safe, /^Appshot-\d{8}-\d{6}\.jpg$/);
});

test("sanitizeAppshotFileName handles Windows reserved names", () => {
  const safe = sanitizeAppshotFileName("CON.jpg", { platform: "win32", now: 0 });
  assert.equal(safe.toLowerCase().startsWith("con"), false);
  assert.match(safe, /^Appshot-\d{8}-\d{6}\.jpg$/);
});
