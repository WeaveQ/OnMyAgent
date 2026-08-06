import assert from "node:assert/strict";
import test from "node:test";

import {
  createLarkCliAuthService,
  extractDeviceCode,
  extractVerificationUrl,
  parseCliJsonBlob,
} from "./lark-cli-auth.mjs";

test("parseCliJsonBlob and extract verification/device fields", () => {
  const raw = `OK line\n{"ok":true,"data":{"verification_url":"https://open.feishu.cn/x","device_code":"dev123"}}\n`;
  assert.equal(extractVerificationUrl(raw), "https://open.feishu.cn/x");
  assert.equal(extractDeviceCode(raw), "dev123");
  assert.equal(parseCliJsonBlob('{"a":1}').a, 1);
});

test("connection status phases from auth status mock", async () => {
  let mode = "none";
  const auth = createLarkCliAuthService({
    runCli: async (args) => {
      if (args[0] === "auth" && args[1] === "status") {
        if (mode === "none") {
          return {
            code: 1,
            stdout: "",
            stderr: "",
            combined: JSON.stringify({
              ok: false,
              error: { type: "config", subtype: "not_configured", message: "not configured" },
            }),
          };
        }
        if (mode === "app") {
          return {
            code: 0,
            stdout: "",
            stderr: "",
            combined: JSON.stringify({
              ok: true,
              appId: "cli_xxx",
              brand: "feishu",
              identities: {
                bot: { available: true, status: "ready" },
                user: { available: false, status: "missing" },
              },
            }),
          };
        }
        return {
          code: 0,
          stdout: "",
          stderr: "",
          combined: JSON.stringify({
            ok: true,
            appId: "cli_xxx",
            brand: "feishu",
            identities: {
              bot: { available: true, status: "ready" },
              user: {
                available: true,
                status: "ready",
                tokenStatus: "valid",
                userName: "Alice",
                openId: "ou_1",
              },
            },
          }),
        };
      }
      if (args[0] === "config" && args[1] === "show") {
        return {
          code: 0,
          stdout: "",
          stderr: "",
          combined: JSON.stringify({ appId: "cli_xxx", brand: "feishu" }),
        };
      }
      throw new Error(args.join(" "));
    },
  });

  mode = "none";
  assert.equal((await auth.getConnectionStatus()).phase, "installed_disconnected");
  mode = "app";
  assert.equal((await auth.getConnectionStatus()).phase, "connected_not_logged_in");
  mode = "user";
  const loggedIn = await auth.getConnectionStatus();
  assert.equal(loggedIn.phase, "connected_logged_in");
  assert.equal(loggedIn.userName, "Alice");
});

test("manual credentials + user login device flow", async () => {
  let configured = false;
  let loggedIn = false;
  const auth = createLarkCliAuthService({
    runCli: async (args, opts = {}) => {
      if (args[0] === "config" && args[1] === "init") {
        assert.ok(String(opts.stdinText).includes("topsecret"));
        configured = true;
        return { code: 0, stdout: "OK", stderr: "", combined: "OK" };
      }
      if (args[0] === "auth" && args[1] === "status") {
        if (!configured) {
          return {
            code: 1,
            stdout: "",
            stderr: "",
            combined: JSON.stringify({
              ok: false,
              error: { type: "config", subtype: "not_configured", message: "not configured" },
            }),
          };
        }
        return {
          code: 0,
          stdout: "",
          stderr: "",
          combined: JSON.stringify({
            ok: true,
            appId: "cli_abcdefgh",
            brand: "feishu",
            identities: {
              bot: { available: true, status: "ready" },
              user: loggedIn
                ? {
                    available: true,
                    status: "ready",
                    tokenStatus: "valid",
                    userName: "Bob",
                  }
                : { available: false, status: "missing" },
            },
          }),
        };
      }
      if (args[0] === "config" && args[1] === "show") {
        return {
          code: 0,
          stdout: "",
          stderr: "",
          combined: JSON.stringify({ appId: "cli_abcdefgh", brand: "feishu" }),
        };
      }
      if (args.join(" ").includes("auth login --recommend --no-wait")) {
        return {
          code: 0,
          stdout: "",
          stderr: "",
          combined: JSON.stringify({
            verification_url: "https://open.feishu.cn/device",
            device_code: "DEVCODE",
          }),
        };
      }
      if (args[0] === "auth" && args[1] === "qrcode") {
        return { code: 1, stdout: "", stderr: "", combined: "" };
      }
      if (args.includes("--device-code")) {
        assert.equal(args[args.indexOf("--device-code") + 1], "DEVCODE");
        loggedIn = true;
        return { code: 0, stdout: "", stderr: "", combined: '{"ok":true}' };
      }
      if (args[0] === "auth" && args[1] === "logout") {
        loggedIn = false;
        return { code: 0, stdout: "", stderr: "", combined: '{"ok":true}' };
      }
      if (args[0] === "config" && args[1] === "remove") {
        configured = false;
        return { code: 0, stdout: "OK", stderr: "", combined: "OK" };
      }
      throw new Error(args.join(" "));
    },
  });

  const afterCreds = await auth.submitManualCredentials({
    appId: "cli_abcdefgh",
    appSecret: "topsecret",
  });
  assert.equal(afterCreds.phase, "connected_not_logged_in");

  const started = await auth.startUserLogin();
  assert.equal(started.verificationUrl, "https://open.feishu.cn/device");
  const afterLogin = await auth.completeUserLogin(started.sessionId);
  assert.equal(afterLogin.phase, "connected_logged_in");

  const disconnected = await auth.disconnect({ clearCredentials: true });
  assert.equal(disconnected.phase, "installed_disconnected");
});

test("getRecommendedScopesJson includes offline_access", async () => {
  const auth = createLarkCliAuthService({
    runCli: async () => ({ code: 0, stdout: "", stderr: "", combined: "" }),
  });
  const parsed = JSON.parse(await auth.getRecommendedScopesJson());
  assert.ok(parsed.scopes.user.includes("offline_access"));
});
