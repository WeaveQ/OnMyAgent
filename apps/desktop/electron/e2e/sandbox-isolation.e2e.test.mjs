/**
 * Expert/OpenCode HOME isolation + logged-out local profile e2e (no live model).
 *
 * Live / dogfood: real ~/.opencode plugins must not enter the product process.
 * Phase-2: logged-out must not create profiles/company or call company HTTP.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  readCompanySettings,
  shouldCallCompany,
} from "../company-client.mjs";
import { resolveCompanyConfigRoot } from "../config-profile-paths.mjs";
import { HOME_CONFIG_SLASH_SKILL_NAMES } from "../opencode-sandbox-home.mjs";
import {
  KNOWLEDGE_TOOL_IDS,
  PLUGIN_LOAD_FAILURE_RE,
  findFreePort,
  isCi,
  requestOpencodeJson,
  resolveOpencodeBin,
  spawnOpencodeServe,
  waitForHealthy,
} from "./opencode-serve.mjs";
import {
  POISON_TOOL_ID,
  createDesktopE2eSandbox,
  sandboxChildEnv,
} from "./sandbox.mjs";

const roots = [];

after(async () => {
  while (roots.length) {
    await rm(roots.pop(), { recursive: true, force: true });
  }
});

function commandNames(body) {
  if (!Array.isArray(body)) return [];
  return body
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return String(item.name ?? item.id ?? "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

describe("desktop sandbox isolation e2e", () => {
  test("logged-out sandbox does not create a company profile", async () => {
    const sandbox = await createDesktopE2eSandbox({
      prefix: "oma-desktop-offline-e2e-",
    });
    roots.push(sandbox.root);
    const settings = readCompanySettings(sandbox.realHome);
    assert.equal(shouldCallCompany(settings), false);
    assert.equal(settings.activeProfile ?? "local", "local");
    assert.equal(existsSync(resolveCompanyConfigRoot(sandbox.realHome)), false);
  });

  test(
    "OpenCode sandbox HOME drops real-home poison plugins and exposes slash core",
    { timeout: 45_000 },
    async (t) => {
      const bin = resolveOpencodeBin();
      if (!bin) {
        if (isCi()) {
          throw new Error(
            "OpenCode binary is required in CI (Runtime job installs it). Set OPENCODE_BIN to override.",
          );
        }
        t.skip("opencode not on PATH; CI Runtime installs the pin from constants.json");
        return;
      }

      const sandbox = await createDesktopE2eSandbox({
        prefix: "oma-desktop-isolation-e2e-",
        poisonPlugin: true,
        linkSlashSkills: true,
      });
      roots.push(sandbox.root);
      assert.ok(existsSync(sandbox.poisonPath));
      assert.notEqual(sandbox.paths.homeDir, sandbox.realHome);
      assert.equal(
        existsSync(
          path.join(sandbox.paths.homeDir, ".opencode", "plugin", "poison.mjs"),
        ),
        false,
      );

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
        const output = server.getOutput();
        assert.doesNotMatch(output, PLUGIN_LOAD_FAILURE_RE, output);

        const ids = await requestOpencodeJson(server.baseUrl, "/experimental/tool/ids", {
          directory: sandbox.workspace,
        });
        assert.equal(
          ids.ok,
          true,
          `tool/ids failed status=${ids.status} body=${JSON.stringify(ids.body)}`,
        );
        const toolIds = Array.isArray(ids.body) ? ids.body : [];
        assert.equal(
          toolIds.includes(POISON_TOOL_ID),
          false,
          `sandbox loaded real-home poison tool: ${JSON.stringify(toolIds)}`,
        );
        for (const toolId of KNOWLEDGE_TOOL_IDS) {
          assert.ok(toolIds.includes(toolId), `missing ${toolId} in ${JSON.stringify(toolIds)}`);
        }

        const commands = await requestOpencodeJson(server.baseUrl, "/command", {
          directory: sandbox.workspace,
        });
        assert.equal(
          commands.ok,
          true,
          `command list failed status=${commands.status} body=${JSON.stringify(commands.body)}`,
        );
        const names = commandNames(commands.body);
        for (const name of ["skill-creator", "find-skills", "knowledge-vault"]) {
          assert.ok(
            names.includes(name),
            `missing /${name} in ${JSON.stringify(names)}; expected core ${JSON.stringify(HOME_CONFIG_SLASH_SKILL_NAMES)}`,
          );
        }
      } finally {
        await server.close();
      }
    },
  );
});
