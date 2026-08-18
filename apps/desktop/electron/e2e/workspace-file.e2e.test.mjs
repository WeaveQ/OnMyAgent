/**
 * First-task workspace file e2e (no live model).
 *
 * Live smoke wrote notes/hello-onmyagent.md via the write tool. CI asserts the
 * same path is listable/readable through OpenCode /file APIs after a disk write.
 */
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
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

const FILE_REL = "notes/hello-onmyagent.md";
const FILE_BODY =
  "OnMyAgent is a local office agent workbench. It helps you create, edit, and verify documents and spreadsheets. Everything runs on your own machine.\n";

const roots = [];

after(async () => {
  while (roots.length) {
    await rm(roots.pop(), { recursive: true, force: true });
  }
});

describe("desktop workspace file e2e", () => {
  test(
    "OpenCode lists and reads a first-task workspace file",
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
        prefix: "oma-desktop-file-e2e-",
        knowledgePlugins: false,
      });
      roots.push(sandbox.root);
      await mkdir(path.join(sandbox.workspace, "notes"), { recursive: true });
      await writeFile(path.join(sandbox.workspace, FILE_REL), FILE_BODY, "utf8");

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
        const listed = await requestOpencodeJson(server.baseUrl, "/file", {
          directory: sandbox.workspace,
          query: { path: "notes" },
        });
        assert.equal(
          listed.ok,
          true,
          `file.list failed status=${listed.status} body=${JSON.stringify(listed.body)}`,
        );
        const nodes = Array.isArray(listed.body) ? listed.body : [];
        assert.ok(
          nodes.some((node) => node?.path === FILE_REL || node?.name === "hello-onmyagent.md"),
          `missing ${FILE_REL} in ${JSON.stringify(nodes)}`,
        );

        const read = await requestOpencodeJson(server.baseUrl, "/file/content", {
          directory: sandbox.workspace,
          query: { path: FILE_REL },
        });
        assert.equal(
          read.ok,
          true,
          `file.read failed status=${read.status} body=${JSON.stringify(read.body)}`,
        );
        assert.equal(read.body?.type, "text");
        assert.match(String(read.body?.content ?? ""), /local office agent workbench/);

        const found = await requestOpencodeJson(server.baseUrl, "/find/file", {
          directory: sandbox.workspace,
          query: { query: "hello-onmyagent" },
        });
        assert.equal(found.ok, true, `find.files failed status=${found.status}`);
        const matches = Array.isArray(found.body) ? found.body : [];
        assert.ok(
          matches.some((item) => String(item).includes(FILE_REL) || String(item).includes("hello-onmyagent.md")),
          `find.files missed ${FILE_REL}: ${JSON.stringify(matches)}`,
        );

        const session = await requestOpencodeJson(server.baseUrl, "/session", {
          method: "POST",
          directory: sandbox.workspace,
          body: { title: "desktop e2e first-task file" },
        });
        assert.equal(
          session.ok,
          true,
          `session.create failed status=${session.status} body=${JSON.stringify(session.body)}`,
        );
        assert.ok(session.body?.id, `session id missing: ${JSON.stringify(session.body)}`);
      } finally {
        await server.close();
      }
    },
  );
});
