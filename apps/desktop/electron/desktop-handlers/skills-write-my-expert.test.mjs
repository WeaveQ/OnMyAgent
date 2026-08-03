import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createSkillsDomainHandlers } from "./skills.mjs";

function createHandlers(root) {
  return createSkillsDomainHandlers({
    mkdir,
    cp,
    myExpertPackageFiles: (_input, packageName) => ({
      plugin: { name: packageName },
      agentMarkdown: "# Test expert\n",
      readme: "# Test expert\n",
    }),
    onmyagentMarketplaceRoot: (marketplace) => path.join(root, marketplace),
    path,
    pathExists: async (target) => stat(target).then(() => true).catch(() => false),
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

test("writeMyExpertPackage persists an uploaded avatar in the expert package", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-avatar-"));
  try {
    const handlers = createHandlers(root);
    const avatarBytes = Buffer.from("avatar-bytes", "utf8");
    await handlers.writeMyExpertPackage({}, [
      {
        packageName: "avatar-helper",
        avatarDataUrl: `data:image/png;base64,${avatarBytes.toString("base64")}`,
      },
    ]);

    assert.deepEqual(
      await readFile(path.join(root, "my-experts", "avatar-helper", "avatars", "avatar.png")),
      avatarBytes,
    );
    const plugin = JSON.parse(
      await readFile(
        path.join(root, "my-experts", "avatar-helper", ".expert-plugin", "plugin.json"),
        "utf8",
      ),
    );
    assert.equal(plugin.avatar, "./avatars/avatar.png");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeMyExpertPackage preserves existing knowledge when requested", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-preserve-"));
  try {
    const handlers = createHandlers(root);
    await handlers.writeMyExpertPackage({}, [
      {
        packageName: "preserved-helper",
        knowledge: [
          {
            kind: "file",
            relativePath: "notes/context.txt",
            dataBase64: Buffer.from("Keep this", "utf8").toString("base64"),
          },
        ],
      },
    ]);
    await handlers.writeMyExpertPackage({}, [
      {
        packageName: "preserved-helper",
        name: "Updated helper",
        preserveKnowledge: true,
      },
    ]);

    assert.equal(
      await readFile(
        path.join(root, "my-experts", "preserved-helper", "knowledge", "notes", "context.txt"),
        "utf8",
      ),
      "Keep this",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stageMyExpertKnowledge copies source files into a hidden draft and finalizes them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-stage-"));
  try {
    const source = path.join(root, "source.txt");
    await writeFile(source, "Draft context", "utf8");
    const handlers = createHandlers(root);
    const staged = await handlers.stageMyExpertKnowledge({}, [
      {
        draftId: "draft-research-helper",
        knowledge: [
          { kind: "directory", relativePath: "product-notes" },
          {
            kind: "file",
            relativePath: "product-notes/source.txt",
            sourcePath: source,
          },
        ],
      },
    ]);

    assert.equal(
      await readFile(path.join(staged.path, "product-notes", "source.txt"), "utf8"),
      "Draft context",
    );

    await handlers.writeMyExpertPackage({}, [
      {
        packageName: "research-helper",
        draftId: "draft-research-helper",
      },
    ]);
    assert.equal(
      await readFile(
        path.join(root, "my-experts", "research-helper", "knowledge", "product-notes", "source.txt"),
        "utf8",
      ),
      "Draft context",
    );
    await assert.rejects(stat(path.join(root, "my-experts", ".drafts", "draft-research-helper")));
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
