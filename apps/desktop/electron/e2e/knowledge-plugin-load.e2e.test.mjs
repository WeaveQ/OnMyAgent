/**
 * Desktop OpenCode plugin-load e2e.
 *
 * Replays the #384 / live-smoke failure: generated knowledge plugins must be
 * loadable by the pinned OpenCode process (export default is a function).
 * No live model, no Electron window, no real ~/.onmyagent.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { KNOWLEDGE_TOOL_PLUGIN_FILES } from "../knowledge-search-plugin.mjs";
import {
  applyOpencodeSandboxEnv,
  prepareOpencodeSandboxHome,
} from "../opencode-sandbox-home.mjs";
import {
  KNOWLEDGE_TOOL_IDS,
  PLUGIN_LOAD_FAILURE_RE,
  fetchOpencodeJson,
  findFreePort,
  isCi,
  resolveOpencodeBin,
  spawnOpencodeServe,
  waitForHealthy,
} from "./opencode-serve.mjs";

const roots = [];

after(async () => {
  while (roots.length) {
    await rm(roots.pop(), { recursive: true, force: true });
  }
});

async function createDesktopSandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-desktop-plugin-e2e-"));
  roots.push(root);
  const realHome = path.join(root, "real-home");
  const userData = path.join(root, "user-data");
  const workspace = path.join(root, "workspace");
  await mkdir(path.join(realHome, ".config", "opencode"), { recursive: true });
  await mkdir(path.join(workspace, ".opencode"), { recursive: true });
  await writeFile(
    path.join(realHome, ".config", "opencode", "opencode.json"),
    `${JSON.stringify({ plugin: [], provider: {} }, null, 2)}\n`,
    "utf8",
  );
  const paths = await prepareOpencodeSandboxHome({
    userDataDir: userData,
    realHomeDir: realHome,
  });
  return { workspace, paths };
}

describe("desktop knowledge plugin load e2e", () => {
  test("sandbox install writes plugin-function sources OpenCode can load", async () => {
    const { paths } = await createDesktopSandbox();
    const config = JSON.parse(await readFile(paths.opencodeConfigPath, "utf8"));
    assert.equal(config.plugin.length, KNOWLEDGE_TOOL_PLUGIN_FILES.length);
    const sources = [];
    for (const file of KNOWLEDGE_TOOL_PLUGIN_FILES) {
      const pluginPath = config.plugin.find((item) => String(item).endsWith(file));
      assert.ok(pluginPath, `missing ${file} in sandbox opencode.json`);
      const source = await readFile(pluginPath, "utf8");
      sources.push(source);
      assert.match(source, /export default async \(\) => \(\{/);
      assert.doesNotMatch(source, /export default tool\(/);
    }
    const joined = sources.join("\n");
    for (const toolId of KNOWLEDGE_TOOL_IDS) {
      assert.match(joined, new RegExp(`${toolId}: tool\\(`));
    }
  });

  test(
    "opencode serve loads knowledge_* tools and does not reject plugin exports",
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

      const { workspace, paths } = await createDesktopSandbox();
      const env = applyOpencodeSandboxEnv(
        {
          ...process.env,
          OPENCODE_CLIENT: "onmyagent-desktop-e2e",
        },
        paths,
      );
      const port = await findFreePort();
      const server = spawnOpencodeServe({ bin, cwd: workspace, env, port });
      try {
        await waitForHealthy(server);
        const output = server.getOutput();
        assert.doesNotMatch(
          output,
          PLUGIN_LOAD_FAILURE_RE,
          `OpenCode rejected knowledge plugins:\n${output}`,
        );

        const ids = await fetchOpencodeJson(server.baseUrl, "/experimental/tool/ids", {
          directory: workspace,
        });
        assert.equal(
          ids.ok,
          true,
          `tool/ids failed status=${ids.status} body=${JSON.stringify(ids.body)}; ${output}`,
        );
        const toolIds = Array.isArray(ids.body) ? ids.body : [];
        for (const toolId of KNOWLEDGE_TOOL_IDS) {
          assert.ok(
            toolIds.includes(toolId),
            `missing ${toolId} in ${JSON.stringify(toolIds)}; ${output}`,
          );
        }
      } finally {
        await server.close();
      }
    },
  );
});
