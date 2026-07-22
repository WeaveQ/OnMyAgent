import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  materializeEnabledArtifactSkills,
  scanBundledArtifactPlugins,
} from "../electron/artifact-plugin-runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bundledPluginsRoot = path.resolve(
  scriptDir,
  "..",
  "resources",
  "bundled-plugins",
);
const expectedSkills = new Map([
  ["browser", ["browser-automation"]],
  ["documents", ["documents"]],
  ["pdf", ["pdf"]],
  ["spreadsheets", ["spreadsheets"]],
]);
const artifactRuntimeRoot = process.env.ONMYAGENT_ARTIFACT_RUNTIME_ROOT?.trim();

function frontmatterValue(markdown, key) {
  const block = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return null;
  const line = block[1]
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${key}:`));
  return line
    ? line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "")
    : null;
}

test("plugin packages are the source of truth for Artifact skill identities", async () => {
  const catalog = await scanBundledArtifactPlugins(bundledPluginsRoot);
  assert.deepEqual(catalog.diagnostics, []);
  assert.deepEqual(
    catalog.items.map((plugin) => plugin.pluginId),
    [...expectedSkills.keys()],
  );
  for (const plugin of catalog.items) {
    assert.deepEqual(
      plugin.skills.map((skill) => skill.id),
      expectedSkills.get(plugin.pluginId),
    );
    for (const skill of plugin.skills) {
      assert.equal(
        (await realpath(skill.sourcePath)).startsWith(
          `${await realpath(path.join(bundledPluginsRoot, plugin.pluginId))}${path.sep}`,
        ),
        true,
      );
      const markdown = await readFile(path.join(skill.sourcePath, "SKILL.md"), "utf8");
      assert.equal(frontmatterValue(markdown, "name"), skill.id);
      assert.ok(frontmatterValue(markdown, "description"));
      if (plugin.pluginId !== "browser") {
        assert.equal(
          existsSync(path.join(skill.sourcePath, "runtime", "artifact_runtime.cjs")),
          true,
        );
        assert.equal(existsSync(path.join(skill.sourcePath, "resources")), true);
        assert.doesNotMatch(markdown, /two directories above|<plugin-root>/);
        assert.match(markdown, /reported (?:skill )?base directory|base directory reported for this skill/);
      }
    }
  }
});

test("managed links resolve to package-local Artifact skills", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-skills-"));
  try {
    const enabledSkillIds = new Set([...expectedSkills.values()].flat());
    const result = await materializeEnabledArtifactSkills({
      pluginRoot: bundledPluginsRoot,
      managedSkillsRoot: path.join(tempRoot, "skills"),
      enabledSkillIds,
    });
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(
      result.items.map((item) => item.skillId).sort(),
      [...enabledSkillIds].sort(),
    );
    for (const item of result.items) {
      assert.equal(await realpath(item.destinationPath), await realpath(item.sourcePath));
      assert.equal(existsSync(path.join(item.destinationPath, "SKILL.md")), true);
      if (item.pluginId !== "browser") {
        assert.equal(
          existsSync(path.join(item.destinationPath, "runtime", "artifact_runtime.cjs")),
          true,
        );
        assert.equal(existsSync(path.join(item.destinationPath, "resources")), true);
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("desktop packaging copies bundled plugin packages into application resources", async () => {
  const builderConfig = await readFile(
    path.resolve(scriptDir, "..", "electron-builder.yml"),
    "utf8",
  );
  assert.match(builderConfig, /from:\s*resources\/bundled-plugins/);
  assert.match(builderConfig, /to:\s*bundled-plugins/);
  assert.match(builderConfig, /from:\s*resources\/bundled-skills/);
  assert.match(builderConfig, /to:\s*bundled-skills/);
});

test("windows electron-builder target is configured for local test packaging", async () => {
  const builderConfig = await readFile(
    path.resolve(scriptDir, "..", "electron-builder.yml"),
    "utf8",
  );
  // Real win product target + sidecars filter for msvc binaries.
  assert.match(builderConfig, /^win:\s*$/m);
  assert.match(builderConfig, /target:\s*\n\s*-\s*nsis/);
  assert.match(builderConfig, /opencode-x86_64-pc-windows-msvc\.exe/);
  assert.match(builderConfig, /onmyagent-orchestrator-x86_64-pc-windows-msvc\.exe/);
  // rcedit must stamp OnMyAgent icon/metadata (signing still optional via CSC_*).
  assert.match(builderConfig, /signAndEditExecutable:\s*true/);
  assert.match(builderConfig, /oneClick:\s*false/);
  assert.match(builderConfig, /output:\s*dist-electron/);
});

test("package runtimes advertise real local JavaScript artifact operations", async () => {
  const catalog = await scanBundledArtifactPlugins(bundledPluginsRoot);
  for (const plugin of catalog.items) {
    // Browser is host-integrated and has no standalone artifact runtime.
    if (plugin.pluginId === "browser") continue;
    const runtime = JSON.parse(
      await readFile(path.join(plugin.root, ".onmyagent", "artifact.json"), "utf8"),
    );
    assert.equal(typeof runtime.runtime?.entry, "string");
    const runtimePath = path.join(plugin.root, runtime.runtime.entry);
    assert.equal(existsSync(runtimePath), true);
    const result = await import("node:child_process").then(({ spawnSync }) =>
      spawnSync(process.execPath, [runtimePath, "--capabilities"], {
        encoding: "utf8",
        env: {
          ...process.env,
          ONMYAGENT_ARTIFACT_RUNTIME_ROOT: path.resolve(scriptDir, "../../../packages/artifact-runtime"),
          NODE_PATH: path.resolve(scriptDir, "../../../packages/artifact-runtime/node_modules"),
        },
      }),
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "ready");
    assert.equal(payload.capabilities.includes("inspect"), true);
    assert.equal(payload.capabilities.includes("verify"), true);
    assert.equal(payload.language, "javascript");
  }
});

test("artifact resources live beside their skills and retired legacy skills cannot reappear", async () => {
  for (const pluginId of ["documents", "spreadsheets", "pdf"]) {
    assert.equal(
      existsSync(
        path.join(bundledPluginsRoot, pluginId, "skills", pluginId, "resources"),
      ),
      true,
    );
    assert.equal(
      existsSync(
        path.resolve(
          bundledPluginsRoot,
          "..",
          "bundled-skills",
          pluginId,
          "SKILL.md",
        ),
      ),
      false,
    );
  }
  assert.equal(
    existsSync(
      path.resolve(
        bundledPluginsRoot,
        "..",
        "bundled-skills",
        "excel-live-control",
        "SKILL.md",
      ),
    ),
    false,
  );
});

test("runtime preparation excludes retired artifact packages", async () => {
  const source = await readFile(path.join(scriptDir, "prepare-runtimes.mjs"), "utf8");
  assert.doesNotMatch(source, /python-docx|openpyxl|python-pptx|reportlab|pdfplumber/);
  assert.doesNotMatch(source, /artifact-wheels/);
  assert.match(source, /supportedRuntimeEntries/);
  assert.match(source, /pruneRetiredRuntimeEntries/);
  const buildSource = await readFile(path.join(scriptDir, "electron-build.mjs"), "utf8");
  assert.match(buildSource, /@onmyagent\/artifact-runtime/);
  assert.match(buildSource, /deploy/);
  assert.match(buildSource, /artifactRuntimeWorkspaceLink/);
  assert.match(buildSource, /"--offline", "--filter", "@onmyagent\/artifact-runtime", "deploy"/);
  assert.match(buildSource, /rmSync\(artifactRuntimeWorkspaceLink, \{ recursive: true, force: true \}\)/);
  const builderSource = await readFile(path.resolve(scriptDir, "..", "electron-builder.yml"), "utf8");
  assert.match(builderSource, /"\*\*\/node\/\*\*"/);
  assert.match(builderSource, /"\*\*\/python\/\*\*"/);
  assert.match(builderSource, /"\*\*\/versions\.json"/);
  assert.match(builderSource, /signIgnore:/);
  assert.match(builderSource, /Contents\/Frameworks\/\.\*\/Resources/);
  assert.match(builderSource, /Contents\/Resources\/runtimes/);
  assert.match(builderSource, /app-dist\|artifact-runtime\|browser\|bundled-plugins\|bundled-skills\|marketplace/);
  assert.match(builderSource, /so\|dylib/);
});

test(
  "packaged JavaScript runtime performs isolated artifact E2E",
  { skip: !artifactRuntimeRoot },
  async () => {
    const runtimeRoot = path.resolve(artifactRuntimeRoot);
    const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-e2e-"));
    const env = {
      ...process.env,
      ONMYAGENT_ARTIFACT_RUNTIME_ROOT: runtimeRoot,
      NODE_PATH: path.join(runtimeRoot, "node_modules"),
    };
    const runJson = (runtime, args) => {
      const result = spawnSync(process.execPath, [runtime, ...args], { encoding: "utf8", env });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout);
    };
    try {
      const fixtureSource = [
        'const fs=require("node:fs"),path=require("node:path");',
        'const {Document,Packer,Paragraph}=require("docx");',
        'const ExcelJS=require("exceljs");',
        'const pptxgen=require("pptxgenjs");',
        'const {PDFDocument,StandardFonts}=require("pdf-lib");',
        '(async()=>{const root=process.argv[1];',
        'fs.writeFileSync(path.join(root,"sample.docx"),await Packer.toBuffer(new Document({sections:[{children:[new Paragraph("OnMyAgent Document")]}]})));',
        'const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet("Data");ws.addRow(["Item","Value"]);ws.addRow(["A",21]);await wb.xlsx.writeFile(path.join(root,"sample.xlsx"));',
        'const deck=new pptxgen();deck.addSlide().addText("OnMyAgent Presentation",{x:1,y:1,w:6,h:1});await deck.writeFile({fileName:path.join(root,"sample.pptx")});',
        'const pdf=await PDFDocument.create();const page=pdf.addPage();const font=await pdf.embedFont(StandardFonts.Helvetica);page.drawText("OnMyAgent PDF",{x:72,y:700,font});fs.writeFileSync(path.join(root,"sample.pdf"),await pdf.save());})();',
      ].join("");
      const fixture = spawnSync(process.execPath, ["-e", fixtureSource, root], { encoding: "utf8", env });
      assert.equal(fixture.status, 0, fixture.stderr);

      const documentsRuntime = path.join(
        bundledPluginsRoot,
        "documents",
        "skills",
        "documents",
        "runtime",
        "artifact_runtime.cjs",
      );
      const spreadsheetsRuntime = path.join(
        bundledPluginsRoot,
        "spreadsheets",
        "skills",
        "spreadsheets",
        "runtime",
        "artifact_runtime.cjs",
      );
      const pdfRuntime = path.join(
        bundledPluginsRoot,
        "pdf",
        "skills",
        "pdf",
        "runtime",
        "artifact_runtime.cjs",
      );
      const presentationRuntime = path.resolve(bundledPluginsRoot, "..", "bundled-skills", "pptx", "runtime", "artifact_runtime.cjs");
      const documentDoctor = runJson(documentsRuntime, ["doctor"]);
      assert.equal(documentDoctor.status, "ready");
      const document = runJson(documentsRuntime, ["verify", path.join(root, "sample.docx")]);
      assert.equal(document.status, "success");
      assert.equal(runJson(spreadsheetsRuntime, ["verify", path.join(root, "sample.xlsx")]).status, "success");
      assert.equal(runJson(presentationRuntime, ["verify", path.join(root, "sample.pptx")]).status, "success");
      const pdf = runJson(pdfRuntime, ["verify", path.join(root, "sample.pdf")]);
      assert.equal(pdf.status, "success");
      assert.equal(pdf.inspection.page_count, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
