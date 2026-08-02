import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSkillsDomainHandlers } from "./skills.mjs";

function createHandlers(root) {
  return createSkillsDomainHandlers({
    mkdir,
    myExpertPackageFiles: (_input, packageName) => ({
      plugin: { name: packageName },
      agentMarkdown: "# Test expert\n",
      readme: "# Test expert\n",
    }),
    onmyagentMarketplaceRoot: (marketplace) => path.join(root, marketplace),
    path,
    rm,
    validateExpertPackageName: (value) => String(value),
    writeFile,
  });
}

test("writeMyExpertPackage stores knowledge under the English knowledge directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-write-"));
  try {
    const handlers = createHandlers(root);
    const result = await handlers.writeMyExpertPackage({}, [
      {
        packageName: "research-helper",
        knowledge: [
          { kind: "directory", relativePath: "product-notes" },
          {
            kind: "file",
            relativePath: "product-notes/brief.txt",
            dataBase64: Buffer.from("Expert context", "utf8").toString("base64"),
          },
        ],
      },
    ]);

    assert.equal(result.marketplace, "my-experts");
    assert.equal(
      await readFile(
        path.join(root, "my-experts", "research-helper", "knowledge", "product-notes", "brief.txt"),
        "utf8",
      ),
      "Expert context",
    );
    assert.equal(
      (await stat(path.join(root, "my-experts", "research-helper", "knowledge"))).isDirectory(),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeMyExpertPackage rejects knowledge paths that escape the package", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-write-"));
  try {
    const handlers = createHandlers(root);
    await assert.rejects(
      handlers.writeMyExpertPackage({}, [
        {
          packageName: "research-helper",
          knowledge: [{ kind: "directory", relativePath: "../outside" }],
        },
      ]),
      /Invalid expert knowledge path/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
