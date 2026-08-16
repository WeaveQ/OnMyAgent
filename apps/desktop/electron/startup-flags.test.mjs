import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLinuxDesktopEnvDefaults,
  configureDesktopStartupFlags,
  resolveElectronExtraLaunchArgs,
  resolveLinuxDesktopEnvDefaults,
  resolveLinuxSessionBusAddress,
  LINUX_DUMMY_SESSION_BUS,
  LINUX_DUMMY_SYSTEM_BUS,
  LINUX_SOFTWARE_RENDER_ARGS,
} from "./startup-flags.mjs";

function createApp() {
  const switches = [];
  return {
    app: {
      commandLine: {
        appendSwitch(name, value) {
          switches.push(value === undefined ? [name] : [name, value]);
        },
      },
    },
    switches,
  };
}

function withEnv(key, value, fn) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
}

test("startup flags only apply explicitly supplied launch switches", async () => {
  await withEnv("ELECTRON_EXTRA_LAUNCH_ARGS", "--disable-http-cache --trace-warnings", async () => {
    await withEnv("ONMYAGENT_DEV_MODE", undefined, async () => {
      const { app, switches } = createApp();
      await configureDesktopStartupFlags(app, { platform: "darwin" });
      assert.deepEqual(switches, [["disable-http-cache"], ["trace-warnings"]]);
    });
  });
});

test("startup flags do not disable HTTP cache from dev mode alone", async () => {
  await withEnv("ELECTRON_EXTRA_LAUNCH_ARGS", undefined, async () => {
    await withEnv("ONMYAGENT_DEV_MODE", "1", async () => {
      const { app, switches } = createApp();
      await configureDesktopStartupFlags(app, { platform: "darwin" });
      assert.deepEqual(switches, [
        [
          "proxy-bypass-list",
          "<-loopback>;<local>;localhost;127.0.0.1;::1;[::1]",
        ],
      ]);
    });
  });
});

test("Linux defaults to software-render when operator did not set extra args", () => {
  assert.equal(
    resolveElectronExtraLaunchArgs({ platform: "linux", extraLaunchArgs: "" }),
    LINUX_SOFTWARE_RENDER_ARGS.join(" "),
  );
  assert.equal(
    resolveElectronExtraLaunchArgs({ platform: "darwin", extraLaunchArgs: "" }),
    "",
  );
  assert.equal(
    resolveElectronExtraLaunchArgs({ platform: "win32", extraLaunchArgs: "" }),
    "",
  );
});

test("operator ELECTRON_EXTRA_LAUNCH_ARGS wins over Linux defaults", () => {
  assert.equal(
    resolveElectronExtraLaunchArgs({
      platform: "linux",
      extraLaunchArgs: "--trace-warnings",
    }),
    "--trace-warnings",
  );
});

test("Linux launch args can also disable HTTP cache after a Vite re-optimize", () => {
  assert.equal(
    resolveElectronExtraLaunchArgs({
      platform: "linux",
      extraLaunchArgs: "",
      resetHttpCache: true,
    }),
    LINUX_SOFTWARE_RENDER_ARGS.concat(["--disable-http-cache"]).join(" "),
  );
});

test("configureDesktopStartupFlags applies Linux software-render switches", async () => {
  await withEnv("ELECTRON_EXTRA_LAUNCH_ARGS", undefined, async () => {
    await withEnv("ONMYAGENT_DEV_MODE", undefined, async () => {
      const { app, switches } = createApp();
      await configureDesktopStartupFlags(app, { platform: "linux" });
      assert.deepEqual(switches, [
        ["disable-gpu"],
        ["disable-gpu-compositing"],
        ["disable-gpu-sandbox"],
        ["in-process-gpu"],
        ["disable-features", "Dbus"],
      ]);
    });
  });
});

test("Linux env defaults set GSETTINGS_BACKEND=memory unless already set", () => {
  assert.deepEqual(
    resolveLinuxDesktopEnvDefaults({
      platform: "linux",
      env: {},
      existsSync: () => false,
    }),
    {
      GSETTINGS_BACKEND: "memory",
      DBUS_FATAL_WARNINGS: "0",
      DBUS_SESSION_BUS_ADDRESS: LINUX_DUMMY_SESSION_BUS,
      DBUS_SYSTEM_BUS_ADDRESS: LINUX_DUMMY_SYSTEM_BUS,
    },
  );
  assert.deepEqual(
    resolveLinuxDesktopEnvDefaults({
      platform: "linux",
      env: { GSETTINGS_BACKEND: "dconf" },
      existsSync: () => false,
    }),
    {
      DBUS_FATAL_WARNINGS: "0",
      DBUS_SESSION_BUS_ADDRESS: LINUX_DUMMY_SESSION_BUS,
      DBUS_SYSTEM_BUS_ADDRESS: LINUX_DUMMY_SYSTEM_BUS,
    },
  );
  assert.deepEqual(
    resolveLinuxDesktopEnvDefaults({ platform: "darwin", env: {} }),
    {},
  );
});

test("Linux env defaults set DBUS_FATAL_WARNINGS and optional session bus", () => {
  assert.equal(
    resolveLinuxSessionBusAddress({
      env: {},
      uid: 1000,
      existsSync: (path) => path === "/run/user/1000/bus",
    }),
    "unix:path=/run/user/1000/bus",
  );
  assert.equal(
    resolveLinuxSessionBusAddress({
      env: {},
      uid: 1000,
      existsSync: () => false,
    }),
    "",
  );
  assert.deepEqual(
    resolveLinuxDesktopEnvDefaults({
      platform: "linux",
      env: { GSETTINGS_BACKEND: "memory", DBUS_FATAL_WARNINGS: "1" },
      uid: 1000,
      existsSync: (path) => path === "/run/user/1000/bus",
    }),
    {
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
      DBUS_SYSTEM_BUS_ADDRESS: LINUX_DUMMY_SYSTEM_BUS,
    },
  );
  const target = {};
  applyLinuxDesktopEnvDefaults(target, {
    platform: "linux",
    existsSync: () => false,
  });
  assert.equal(target.DBUS_FATAL_WARNINGS, "0");
  assert.equal(target.GSETTINGS_BACKEND, "memory");
  assert.equal(target.DBUS_SESSION_BUS_ADDRESS, LINUX_DUMMY_SESSION_BUS);
  assert.equal(target.DBUS_SYSTEM_BUS_ADDRESS, LINUX_DUMMY_SYSTEM_BUS);
});
