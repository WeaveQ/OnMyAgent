import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLinuxSystemPermissions,
  linuxSandboxUnsupportedReason,
  resolveLinuxPermissionSettingsCommand,
  resolveDesktopPlatformCapabilities,
  resolveLinuxSandboxBackend,
} from "./desktop-platform-capabilities.mjs";

test("Linux sandbox backend reports docker, then bwrap, then none", () => {
  assert.equal(
    resolveLinuxSandboxBackend({
      platform: "linux",
      env: { PATH: "/opt/bin", ONMYAGENT_DOCKER_BIN: "/opt/bin/docker" },
      existsSync: (path) => path === "/opt/bin/docker",
    }),
    "docker",
  );
  assert.equal(
    resolveLinuxSandboxBackend({
      platform: "linux",
      env: { PATH: "/usr/bin" },
      existsSync: (path) => path === "/usr/bin/bwrap",
    }),
    "bwrap",
  );
  assert.equal(
    resolveLinuxSandboxBackend({
      platform: "linux",
      env: { PATH: "/empty" },
      existsSync: () => false,
    }),
    "none",
  );
  assert.equal(
    resolveLinuxSandboxBackend({
      platform: "darwin",
      env: { PATH: "/usr/bin" },
      existsSync: () => true,
    }),
    "none",
  );
});

test("Linux capabilities include sandbox docker|bwrap|none and keep sandbox-exec macOS-only", () => {
  const none = resolveDesktopPlatformCapabilities("linux", {
    env: { PATH: "" },
    existsSync: () => false,
  });
  assert.equal(none.sandboxExec.supported, false);
  assert.equal(none.sandbox.backend, "none");
  assert.equal(none.sandbox.supported, false);
  assert.match(none.sandbox.reason ?? "", /Docker or bubblewrap/i);
  assert.equal(linuxSandboxUnsupportedReason("none").includes("skipped"), true);

  const docker = resolveDesktopPlatformCapabilities("linux", {
    env: { PATH: "/usr/bin" },
    existsSync: (path) => path.endsWith("/docker"),
  });
  assert.equal(docker.sandbox.backend, "docker");
  assert.equal(docker.sandbox.supported, true);
  assert.equal(docker.sandbox.reason, null);

  const macos = resolveDesktopPlatformCapabilities("darwin");
  assert.equal(macos.sandboxExec.supported, true);
  assert.equal(macos.sandbox.backend, "sandbox-exec");
  assert.equal(macos.sandbox.supported, true);
});

test("Linux system permissions check workspace/fs and never fake camera/mic/accessibility", () => {
  const granted = buildLinuxSystemPermissions({
    homeDir: "/home/hope",
    readdirSync: () => ["notes"],
    notificationStatus: "granted",
  });
  assert.equal(granted["full-disk-access"], "granted");
  assert.equal(granted.notifications, "granted");
  assert.equal(granted.microphone, "unknown");
  assert.equal(granted.accessibility, "unknown");
  assert.equal(granted.automation, "unknown");
  assert.equal(granted["screen-recording"], "unknown");

  const denied = buildLinuxSystemPermissions({
    homeDir: "/home/hope",
    readdirSync: () => {
      const err = new Error("denied");
      err.code = "EACCES";
      throw err;
    },
    notificationStatus: "unknown",
  });
  assert.equal(denied["full-disk-access"], "denied");
  assert.equal(denied.notifications, "unknown");
  assert.equal(denied.microphone, "unknown");
});

test("Linux permissions accept queried mic/screen status and never invent granted", () => {
  const queried = buildLinuxSystemPermissions({
    homeDir: "/home/hope",
    readdirSync: () => [],
    notificationStatus: "denied",
    microphoneStatus: "denied",
    screenRecordingStatus: "not-determined",
  });
  assert.equal(queried.notifications, "denied");
  assert.equal(queried.microphone, "denied");
  assert.equal(queried["screen-recording"], "unknown");
  assert.equal(queried.accessibility, "unknown");
});

test("Linux permission settings resolve GNOME, KDE, or xdg-open", () => {
  assert.deepEqual(
    resolveLinuxPermissionSettingsCommand("notifications", { desktop: "GNOME" }),
    { command: "gnome-control-center", args: ["notifications"] },
  );
  assert.deepEqual(
    resolveLinuxPermissionSettingsCommand("microphone", { desktop: "KDE" }),
    { command: "systemsettings", args: ["kcm_privacy"] },
  );
  assert.deepEqual(
    resolveLinuxPermissionSettingsCommand("screen-recording", { desktop: "xfce" }),
    { command: "xdg-open", args: ["settings://privacy"] },
  );
});
