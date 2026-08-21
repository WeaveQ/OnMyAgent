import assert from "node:assert/strict";
import test from "node:test";
import {
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createExpertMarketplace } from "../expert-marketplace.mjs";
import { createSkillsDomainHandlers } from "./skills.mjs";

function createHandlers(root, options = {}) {
  return createSkillsDomainHandlers({
    mkdir,
    cp: options.cp ?? cp,
    myExpertPackageFiles: options.myExpertPackageFiles ?? ((_input, packageName) => ({
      plugin: { name: packageName },
      agentMarkdown: "# Test expert\n",
      readme: "# Test expert\n",
    })),
    onmyagentMarketplaceRoot: (marketplace) => path.join(root, marketplace),
    path,
    pathExists: async (target) => stat(target).then(() => true).catch(() => false),
    listLocalSkills: options.listLocalSkills ?? (async () => []),
    rename,
    readFile,
    rm,
    validateExpertPackageName: (value) => String(value),
    validateSkillName: (value) => String(value),
    writeFile,
  });
}

async function writeSkill(root, name, files = {}) {
  const skillRoot = path.join(root, name);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill\n---\n`,
    "utf8",
  );
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(skillRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return skillRoot;
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

test("writeMyExpertPackage copies complete selected skill trees into the expert package", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-skills-"));
  try {
    const skillRoot = await writeSkill(root, "research-skill", {
      "scripts/run.mjs": "export const run = true;\n",
      "references/guide.md": "# Guide\n",
    });
    const handlers = createHandlers(root, {
      listLocalSkills: async () => [
        { name: "research-skill", path: skillRoot },
      ],
    });

    await handlers.writeMyExpertPackage({}, [
      {
        packageName: "research-helper",
        skills: ["research-skill"],
        skillSourceWorkspaceRoot: "/workspace",
      },
    ]);

    const copiedRoot = path.join(
      root,
      "my-experts",
      "research-helper",
      "skills",
      "research-skill",
    );
    assert.match(await readFile(path.join(copiedRoot, "SKILL.md"), "utf8"), /name: research-skill/);
    assert.equal(await readFile(path.join(copiedRoot, "scripts/run.mjs"), "utf8"), "export const run = true;\n");
    assert.equal(await readFile(path.join(copiedRoot, "references/guide.md"), "utf8"), "# Guide\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeMyExpertPackage documents each bundled skill trigger and location in the agent markdown", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-skill-guide-"));
  try {
    const skillRoot = await writeSkill(root, "research-skill", {
      "references/guide.md": "# Guide\n",
    });
    const marketplace = createExpertMarketplace({ getRealHomeDir: () => root });
    const handlers = createHandlers(root, {
      myExpertPackageFiles: marketplace.myExpertPackageFiles,
      listLocalSkills: async () => [
        { name: "research-skill", path: skillRoot },
      ],
    });

    await handlers.writeMyExpertPackage({}, [
      {
        packageName: "research-helper",
        name: "Research helper",
        skills: ["research-skill"],
        skillSourceWorkspaceRoot: "/workspace",
      },
    ]);

    const markdown = await readFile(
      path.join(root, "my-experts", "research-helper", "agents", "research-helper.md"),
      "utf8",
    );
    assert.match(markdown, /`research-skill`/);
    assert.match(markdown, /Test skill/);
    assert.match(markdown, /\.\.\/skills\/research-skill\/SKILL\.md/);
    assert.match(markdown, /\.opencode\/skills\/research-skill\/SKILL\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeMyExpertPackage dereferences linked skill sources into a self-contained package", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-linked-skill-"));
  try {
    const skillRoot = await writeSkill(root, "linked-skill", {
      "scripts/run.mjs": "export const linked = true;\n",
    });
    const linkedSource = path.join(root, "linked-source");
    await symlink(skillRoot, linkedSource, "dir");
    const handlers = createHandlers(root, {
      listLocalSkills: async () => [
        { name: "linked-skill", path: linkedSource },
      ],
    });

    await handlers.writeMyExpertPackage({}, [
      {
        packageName: "linked-helper",
        skills: ["linked-skill"],
        skillSourceWorkspaceRoot: "/workspace",
      },
    ]);

    const copiedRoot = path.join(root, "my-experts", "linked-helper", "skills", "linked-skill");
    assert.equal((await lstat(copiedRoot)).isSymbolicLink(), false);
    assert.equal(
      await readFile(path.join(copiedRoot, "scripts/run.mjs"), "utf8"),
      "export const linked = true;\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeMyExpertPackage removes deselected skills when updating an expert", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-skills-update-"));
  try {
    const retainedRoot = await writeSkill(root, "retained-skill");
    const removedRoot = await writeSkill(root, "removed-skill");
    const handlers = createHandlers(root, {
      listLocalSkills: async () => [
        { name: "retained-skill", path: retainedRoot },
        { name: "removed-skill", path: removedRoot },
      ],
    });
    const baseInput = {
      packageName: "editing-helper",
      skillSourceWorkspaceRoot: "/workspace",
    };

    await handlers.writeMyExpertPackage({}, [
      { ...baseInput, skills: ["retained-skill", "removed-skill"] },
    ]);
    await handlers.writeMyExpertPackage({}, [
      { ...baseInput, skills: ["retained-skill"] },
    ]);

    const skillsRoot = path.join(root, "my-experts", "editing-helper", "skills");
    assert.equal((await stat(path.join(skillsRoot, "retained-skill"))).isDirectory(), true);
    await assert.rejects(stat(path.join(skillsRoot, "removed-skill")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeMyExpertPackage keeps the previous expert package when a selected skill is unavailable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-skills-missing-"));
  try {
    const packageRoot = path.join(root, "my-experts", "safe-helper");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, "existing.txt"), "keep me", "utf8");
    const handlers = createHandlers(root);

    await assert.rejects(
      handlers.writeMyExpertPackage({}, [
        {
          packageName: "safe-helper",
          skills: ["missing-skill"],
          skillSourceWorkspaceRoot: "/workspace",
        },
      ]),
      /Expert skill source not found: missing-skill/,
    );
    assert.equal(await readFile(path.join(packageRoot, "existing.txt"), "utf8"), "keep me");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writeMyExpertPackage restores the previous expert package when skill copy fails during replacement", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-skills-rollback-"));
  try {
    const packageRoot = path.join(root, "my-experts", "safe-helper");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(path.join(packageRoot, "existing.txt"), "keep me", "utf8");
    const skillRoot = await writeSkill(root, "unstable-skill");
    const handlers = createHandlers(root, {
      listLocalSkills: async () => [
        { name: "unstable-skill", path: skillRoot },
      ],
      cp: async (source, destination, options) => {
        if (destination.includes(`${path.sep}safe-helper${path.sep}skills${path.sep}`)) {
          throw new Error("simulated skill copy failure");
        }
        return cp(source, destination, options);
      },
    });

    await assert.rejects(
      handlers.writeMyExpertPackage({}, [
        {
          packageName: "safe-helper",
          skills: ["unstable-skill"],
          skillSourceWorkspaceRoot: "/workspace",
        },
      ]),
      /simulated skill copy failure/,
    );
    assert.equal(await readFile(path.join(packageRoot, "existing.txt"), "utf8"), "keep me");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
