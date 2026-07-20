import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  createComputerUseDesktopHelpers,
  parseComputerUseActivity,
  parseComputerUseStatus,
} from "./computer-use-desktop.mjs";

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  /** @type {number | null} */
  exitCode = null;
  /** @type {string[]} */
  killSignals = [];

  /** @param {string} signal */
  kill(signal) {
    this.killSignals.push(signal);
    this.exitCode = 0;
  }
}

test("parseComputerUseStatus preserves permission, version, activity, Skysight, and app authorization state", () => {
  assert.deepEqual(
    parseComputerUseStatus(JSON.stringify({
      ok: true,
      accessibility: true,
      screenRecording: true,
      helperVersion: "1.2.3",
      protocolVersion: 1,
      activity: { phase: "paused", reason: "physical_input" },
      skysight: { enabled: true, retentionDays: 30 },
      appAuthorizations: {
        version: 1,
        allowedBundleIdentifiers: ["com.apple.Safari"],
      },
    })),
    {
      ok: true,
      accessibility: true,
      screenRecording: true,
      helperVersion: "1.2.3",
      protocolVersion: 1,
      activity: { phase: "paused", reason: "physical_input" },
      skysight: { enabled: true, retentionDays: 30 },
      appAuthorizations: {
        version: 1,
        allowedBundleIdentifiers: ["com.apple.Safari"],
      },
    },
  );
});

test("authorization helpers revoke one app or clear all and return fresh status", async () => {
  const spawned = [];
  const spawnProcess = (_bin, args) => {
    spawned.push(args);
    const child = new FakeChildProcess();
    queueMicrotask(() => {
      if (args[0] === "--status") {
        child.stdout.write(`${JSON.stringify({
          ok: true,
          accessibility: true,
          screenRecording: true,
          appAuthorizations: { version: 1, allowedBundleIdentifiers: [] },
        })}\n`);
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

  await helpers.revokeComputerUseAppAuthorization("com.apple.Safari");
  await helpers.clearComputerUseAppAuthorizations();

  assert.equal(
    spawned.some((args) => args.join(" ") === "authorization revoke com.apple.Safari"),
    true,
  );
  assert.equal(
    spawned.some((args) => args.join(" ") === "authorization clear"),
    true,
  );
});

test("parseComputerUseStatus rejects malformed helper output", () => {
  assert.equal(parseComputerUseStatus("not-json"), null);
  assert.equal(parseComputerUseStatus("{}"), null);
});

test("parseComputerUseActivity accepts only known runtime phases", () => {
  assert.deepEqual(parseComputerUseActivity({
    phase: "paused",
    app: "Safari",
    reason: "physical_input",
  }), {
    phase: "paused",
    app: "Safari",
    reason: "physical_input",
  });
  assert.equal(parseComputerUseActivity({ phase: "unknown" }), null);
});

test("Skysight restore starts one managed recorder and dispose terminates it", async () => {
  const spawned = [];
  const recorder = new FakeChildProcess();
  const appshotMonitor = new FakeChildProcess();

  const spawnProcess = (_bin, args) => {
    spawned.push(args);
    if (args[0] === "skysight" && args[1] === "record") return recorder;
    if (args[0] === "appshot" && args[1] === "monitor") return appshotMonitor;
    const child = new FakeChildProcess();
    queueMicrotask(() => {
      if (args[0] === "--status") {
        child.stdout.write(`${JSON.stringify({
          ok: true,
          accessibility: true,
          screenRecording: true,
          skysight: { enabled: true, retentionDays: 30 },
        })}\n`);
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
  assert.equal(spawned.filter((args) => args.join(" ") === "appshot monitor").length, 1);
  assert.equal(status.skysight.recording, true);
  helpers.disposeComputerUseServices();
  assert.deepEqual(recorder.killSignals, ["SIGTERM"]);
  assert.deepEqual(appshotMonitor.killSignals, ["SIGTERM"]);
});

test("Skysight helpers pause, resume, and update exclusions", async () => {
  const spawned = [];
  const spawnProcess = (_bin, args) => {
    spawned.push(args);
    const child = new FakeChildProcess();
    queueMicrotask(() => {
      if (args[0] === "--status") {
        child.stdout.write(`${JSON.stringify({
          ok: true,
          accessibility: true,
          screenRecording: true,
          skysight: {
            enabled: true,
            paused: false,
            retentionDays: 30,
            exclusions: [{ scope: "private_browsing" }],
          },
        })}\n`);
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

test("Appshot capture returns an attachable image payload", async () => {
  const spawned = [];
  const spawnProcess = (_bin, args) => {
    spawned.push(args);
    const child = new FakeChildProcess();
    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({
        ok: true,
        path: "/tmp/appshot.jpg",
        name: "Appshot-Safari.jpg",
        mimeType: "image/jpeg",
      })}\n`);
      child.stdout.end();
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
    readFile: () => Buffer.from("jpeg-bytes"),
    resolveComputerUseExecutable: () => "/fake/ComputerUse",
  });
  // Force macOS path for this unit test regardless of host OS.
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "darwin" });
  try {
    const result = await helpers.captureComputerUseAppshot();
    assert.equal(spawned.some((args) => args.join(" ") === "appshot capture"), true);
    assert.equal(result.mimeType, "image/jpeg");
    assert.equal(result.name, "Appshot-Safari.jpg");
    assert.equal(result.data, Buffer.from("jpeg-bytes").toString("base64"));
  } finally {
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  }
});

test("sanitizeAppshotFileName strips Swift JoinedSequence dumps", async () => {
  const { sanitizeAppshotFileName } = await import("./computer-use-desktop.mjs");
  const garbage =
    'Appshot-20260720-JoinedSequence<Array<ArraySlice<Character>>>(_base: [ArraySlice(["O"])], _separator: ContiguousArray(["-"])).jpg';
  const safe = sanitizeAppshotFileName(garbage, { platform: "darwin", now: 0 });
  assert.equal(safe.includes("JoinedSequence"), false);
  assert.match(safe, /^Appshot-\d{8}-\d{6}\.jpg$/);
});

test("sanitizeAppshotFileName handles Windows reserved names", async () => {
  const { sanitizeAppshotFileName } = await import("./computer-use-desktop.mjs");
  const safe = sanitizeAppshotFileName("CON.jpg", { platform: "win32", now: 0 });
  assert.equal(safe.toLowerCase().startsWith("con"), false);
  assert.match(safe, /^Appshot-\d{8}-\d{6}\.jpg$/);
});

test("Appshot capture rejects non-macOS platforms", async () => {
  const helpers = createComputerUseDesktopHelpers({
    app: { getVersion: () => "0.1.0", isPackaged: false },
    shell: {},
    dialog: {},
    systemPreferences: {},
    dirname: "/tmp/onmyagent/electron",
    spawnProcess: () => new FakeChildProcess(),
    readFile: () => Buffer.from("jpeg-bytes"),
    resolveComputerUseExecutable: () => "/fake/ComputerUse",
  });
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    await assert.rejects(
      () => helpers.captureComputerUseAppshot(),
      /only available on macOS/i,
    );
  } finally {
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  }
});
