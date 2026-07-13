import assert from "node:assert/strict";
import test from "node:test";

import {
  clearDownloadQuarantine,
  movePreparedRuntimeTree,
  preparedRuntimeRoot,
} from "./runtime-archive.mjs";

test("clears recursive macOS quarantine before extracting a runtime archive", () => {
  const calls = [];
  clearDownloadQuarantine("/tmp/python.tar.gz", {
    platform: "darwin",
    spawn(command, args) {
      calls.push({ command, args });
      return { status: 0 };
    },
  });
  assert.deepEqual(calls, [
    {
      command: "xattr",
      args: ["-d", "com.apple.quarantine", "/tmp/python.tar.gz"],
    },
  ]);
});

test("does not invoke xattr on other platforms", () => {
  let invoked = false;
  clearDownloadQuarantine("C:\\runtime.zip", {
    platform: "win32",
    spawn() {
      invoked = true;
      return { status: 0 };
    },
  });
  assert.equal(invoked, false);
});

test("tolerates archives that have no quarantine attribute", () => {
  assert.doesNotThrow(() =>
    clearDownloadQuarantine("/tmp/node.tar.gz", {
      platform: "darwin",
      spawn() {
        return { status: 1 };
      },
    }),
  );
});

test("moves prepared runtime trees without copying executable files", () => {
  const calls = [];
  movePreparedRuntimeTree("/runtime-work/python", "/runtime/python", {
    rename(source, destination) {
      calls.push({ source, destination });
    },
  });
  assert.deepEqual(calls, [
    {
      source: "/runtime-work/python",
      destination: "/runtime/python",
    },
  ]);
});

test("uses an executable prepared directory instead of the blocked staging suffix", () => {
  assert.equal(
    preparedRuntimeRoot("/runtime/aarch64-apple-darwin"),
    "/runtime/aarch64-apple-darwin.prepared",
  );
});
