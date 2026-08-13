import assert from "node:assert/strict";
import test from "node:test";
import { configureDesktopStartupFlags } from "./startup-flags.mjs";

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

test("startup flags only apply explicitly supplied launch switches", async () => {
  const previous = process.env.ELECTRON_EXTRA_LAUNCH_ARGS;
  const previousDevMode = process.env.ONMYAGENT_DEV_MODE;
  process.env.ELECTRON_EXTRA_LAUNCH_ARGS = "--disable-http-cache --trace-warnings";
  delete process.env.ONMYAGENT_DEV_MODE;
  try {
    const { app, switches } = createApp();
    await configureDesktopStartupFlags(app);
    assert.deepEqual(switches, [["disable-http-cache"], ["trace-warnings"]]);
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_EXTRA_LAUNCH_ARGS;
    else process.env.ELECTRON_EXTRA_LAUNCH_ARGS = previous;
    if (previousDevMode === undefined) delete process.env.ONMYAGENT_DEV_MODE;
    else process.env.ONMYAGENT_DEV_MODE = previousDevMode;
  }
});

test("startup flags do not disable HTTP cache from dev mode alone", async () => {
  const previousArgs = process.env.ELECTRON_EXTRA_LAUNCH_ARGS;
  const previousDevMode = process.env.ONMYAGENT_DEV_MODE;
  delete process.env.ELECTRON_EXTRA_LAUNCH_ARGS;
  process.env.ONMYAGENT_DEV_MODE = "1";
  try {
    const { app, switches } = createApp();
    await configureDesktopStartupFlags(app);
    assert.deepEqual(switches, [
      [
        "proxy-bypass-list",
        "<-loopback>;<local>;localhost;127.0.0.1;::1;[::1]",
      ],
    ]);
  } finally {
    if (previousArgs === undefined) delete process.env.ELECTRON_EXTRA_LAUNCH_ARGS;
    else process.env.ELECTRON_EXTRA_LAUNCH_ARGS = previousArgs;
    if (previousDevMode === undefined) delete process.env.ONMYAGENT_DEV_MODE;
    else process.env.ONMYAGENT_DEV_MODE = previousDevMode;
  }
});
