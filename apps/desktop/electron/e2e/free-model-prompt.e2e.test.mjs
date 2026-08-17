/**
 * Optional live free-model prompt e2e.
 *
 * Off by default: CI Runtime has no Zen credentials. Enable with
 * OPENCODE_E2E_LIVE_MODEL=1. Copies auth.json into the temp sandbox only;
 * never uses the real HOME as OpenCode HOME.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  findFreePort,
  isCi,
  requestOpencodeJson,
  resolveOpencodeBin,
  spawnOpencodeServe,
  waitForHealthy,
} from "./opencode-serve.mjs";
import { createDesktopE2eSandbox, sandboxChildEnv } from "./sandbox.mjs";

const MARKER = "Session free-model smoke OK.";

const roots = [];

after(async () => {
  while (roots.length) {
    await rm(roots.pop(), { recursive: true, force: true });
  }
});

function liveModelEnabled() {
  return process.env.OPENCODE_E2E_LIVE_MODEL === "1";
}

function resolveRealAuthPath() {
  const override = process.env.OPENCODE_E2E_AUTH_JSON?.trim();
  if (override && existsSync(override)) return override;
  const home = os.homedir();
  const candidates = [
    path.join(home, ".local", "share", "opencode", "auth.json"),
    path.join(home, ".config", "opencode", "auth.json"),
  ];
  return candidates.find((item) => existsSync(item)) ?? null;
}

function resolveModel() {
  const providerID = process.env.OPENCODE_E2E_PROVIDER?.trim() || "opencode";
  const modelID = process.env.OPENCODE_E2E_MODEL?.trim() || "deepseek-v4-flash-free";
  return { providerID, modelID };
}

function collectText(payload) {
  const chunks = [];
  const visit = (value) => {
    if (!value) return;
    if (typeof value === "string") {
      chunks.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "object") {
      if (typeof value.text === "string") chunks.push(value.text);
      visit(value.parts);
      visit(value.messages);
    }
  };
  visit(payload);
  return chunks.join("\n");
}

describe("desktop free-model prompt e2e", () => {
  test(
    "free model replies with the exact smoke sentence",
    { timeout: 120_000 },
    async (t) => {
      if (!liveModelEnabled()) {
        t.skip("set OPENCODE_E2E_LIVE_MODEL=1 to run the live free-model prompt");
        return;
      }
      const bin = resolveOpencodeBin();
      if (!bin) {
        if (isCi()) {
          throw new Error(
            "OPENCODE_E2E_LIVE_MODEL=1 requires an OpenCode binary (OPENCODE_BIN).",
          );
        }
        t.skip("opencode not on PATH");
        return;
      }
      const authSrc = resolveRealAuthPath();
      if (!authSrc) {
        t.skip("no OpenCode auth.json; cannot call a live free model");
        return;
      }

      const sandbox = await createDesktopE2eSandbox({
        prefix: "oma-desktop-live-model-e2e-",
        seedAuthJson: authSrc,
      });
      roots.push(sandbox.root);

      const env = sandboxChildEnv(sandbox);
      const port = await findFreePort();
      const server = spawnOpencodeServe({
        bin,
        cwd: sandbox.workspace,
        env,
        port,
      });
      try {
        await waitForHealthy(server);
        const session = await requestOpencodeJson(server.baseUrl, "/session", {
          method: "POST",
          directory: sandbox.workspace,
          body: { title: "desktop e2e free-model smoke" },
        });
        assert.equal(
          session.ok,
          true,
          `session.create failed status=${session.status}`,
        );
        const sessionId = session.body?.id;
        assert.ok(sessionId, "session id missing");

        const prompt = await requestOpencodeJson(
          server.baseUrl,
          `/session/${sessionId}/message`,
          {
            method: "POST",
            directory: sandbox.workspace,
            timeoutMs: 90_000,
            body: {
              parts: [
                {
                  type: "text",
                  text: `Reply with exactly this sentence and nothing else: ${MARKER}`,
                },
              ],
              model: resolveModel(),
            },
          },
        );
        assert.equal(
          prompt.ok,
          true,
          `prompt failed status=${prompt.status}`,
        );
        const text = collectText(prompt.body);
        assert.match(
          text,
          /Session free-model smoke OK/,
          `model reply missing marker: ${text.slice(0, 400)}`,
        );
      } finally {
        await server.close();
      }
    },
  );
});
