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
          existsSync(path.join(skill.sourcePath, "runtime", "artifact_runtime.py")),
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
          existsSync(path.join(item.destinationPath, "runtime", "artifact_runtime.py")),
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

test("package runtimes advertise real local artifact operations", async () => {
  const catalog = await scanBundledArtifactPlugins(bundledPluginsRoot);
  for (const plugin of catalog.items) {
    // Browser is host-integrated (Electron in-app browser); it has no Python runtime.
    if (plugin.pluginId === "browser") continue;
    const runtime = JSON.parse(
      await readFile(path.join(plugin.root, ".onmyagent", "artifact.json"), "utf8"),
    );
    assert.equal(typeof runtime.runtime?.entry, "string");
    const runtimePath = path.join(plugin.root, runtime.runtime.entry);
    assert.equal(existsSync(runtimePath), true);
    const result = await import("node:child_process").then(({ spawnSync }) =>
      spawnSync("python3", [runtimePath, "--capabilities"], { encoding: "utf8" }),
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "ready");
    assert.equal(payload.capabilities.includes("inspect"), true);
    assert.equal(payload.capabilities.includes("render"), true);
    assert.equal(payload.capabilities.includes("verify"), true);
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

test("runtime preparation pins and validates local artifact dependencies", async () => {
  const source = await readFile(path.join(scriptDir, "prepare-runtimes.mjs"), "utf8");
  for (const dependency of [
    "python-docx",
    "openpyxl",
    "pandas",
    "pypdf",
    "pdfplumber",
    "reportlab",
    "PyMuPDF",
  ]) {
    assert.match(source, new RegExp(`${dependency.replace("-", "-")}==`));
  }
  assert.match(source, /pythonArtifactPackagesWork/);
  assert.match(source, /--no-index/);
  assert.match(source, /artifact-wheels/);
  assert.match(source, /libreOfficeVersion = "25\.8\.2\.2"/);
  assert.match(source, /downloadarchive\.documentfoundation\.org/);
  assert.match(source, /officeWorks/);
  assert.match(source, /skipOffice/);
  assert.match(source, /--skip-office/);
});

test(
  "packaged runtime performs isolated DOCX, spreadsheet, and PDF E2E",
  { skip: !artifactRuntimeRoot },
  async () => {
    const runtimeRoot = path.resolve(artifactRuntimeRoot);
    const python = path.join(
      runtimeRoot,
      "python",
      process.platform === "win32" ? "python.exe" : "bin/python3",
    );
    const runtimePath = [
      path.join(runtimeRoot, "bin"),
      path.dirname(python),
      ...(process.platform === "win32"
        ? [path.join(runtimeRoot, "libreoffice", "LibreOffice", "program")]
        : ["/usr/bin", "/bin"]),
    ].join(path.delimiter);
    const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-artifact-e2e-"));
    const env = {
      PATH: runtimePath,
      Path: runtimePath,
      TMPDIR: os.tmpdir(),
      TEMP: os.tmpdir(),
      TMP: os.tmpdir(),
    };
    const runJson = (args) => {
      const result = spawnSync(python, args, { encoding: "utf8", env });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout);
    };
    try {
      const fixture = spawnSync(
        python,
        [
          "-c",
          [
            "import sys",
            "from pathlib import Path",
            "from docx import Document",
            "from openpyxl import Workbook",
            "from reportlab.pdfgen import canvas",
            "root=Path(sys.argv[1])",
            "doc=Document()",
            "doc.add_heading('OnMyAgent Document',0)",
            "doc.add_paragraph('Local connector verification.')",
            "doc.add_table(rows=2,cols=2)",
            "doc.save(root/'sample.docx')",
            "wb=Workbook()",
            "ws=wb.active",
            "ws.append(['Item','Value','Double'])",
            "ws.append(['A',21,'=B2*2'])",
            "wb.save(root/'sample.xlsx')",
            "pdf=canvas.Canvas(str(root/'sample.pdf'))",
            "pdf.drawString(72,750,'OnMyAgent PDF connector verification')",
            "pdf.showPage()",
            "pdf.save()",
          ].join(";"),
          root,
        ],
        { encoding: "utf8", env },
      );
      assert.equal(fixture.status, 0, fixture.stderr);

      const documentsRuntime = path.join(
        bundledPluginsRoot,
        "documents",
        "skills",
        "documents",
        "runtime",
        "artifact_runtime.py",
      );
      const spreadsheetsRuntime = path.join(
        bundledPluginsRoot,
        "spreadsheets",
        "skills",
        "spreadsheets",
        "runtime",
        "artifact_runtime.py",
      );
      const pdfRuntime = path.join(
        bundledPluginsRoot,
        "pdf",
        "skills",
        "pdf",
        "runtime",
        "artifact_runtime.py",
      );
      const documentDoctor = runJson([documentsRuntime, "doctor"]);
      assert.equal(documentDoctor.status, "ready");
      assert.equal(
        documentDoctor.dependencies.office_renderer.path.startsWith(runtimeRoot),
        true,
      );
      const document = runJson([
        documentsRuntime,
        "verify",
        path.join(root, "sample.docx"),
        "--output-dir",
        path.join(root, "document-render"),
      ]);
      assert.equal(document.status, "success");
      assert.equal(existsSync(document.render.pdf), true);

      const initialWorkbook = runJson([
        spreadsheetsRuntime,
        "verify",
        path.join(root, "sample.xlsx"),
      ]);
      assert.equal(initialWorkbook.status, "issues_found");
      assert.match(initialWorkbook.issues[0], /recalculate/);
      const recalculated = runJson([
        spreadsheetsRuntime,
        "recalculate",
        path.join(root, "sample.xlsx"),
        "--output-dir",
        path.join(root, "recalculated"),
      ]);
      assert.equal(recalculated.status, "success");
      const finalWorkbook = runJson([
        spreadsheetsRuntime,
        "verify",
        recalculated.output,
      ]);
      assert.equal(finalWorkbook.status, "success");

      const pdf = runJson([
        pdfRuntime,
        "verify",
        path.join(root, "sample.pdf"),
        "--output-dir",
        path.join(root, "pdf-render"),
      ]);
      assert.equal(pdf.status, "success");
      assert.equal(pdf.render.page_count, 1);
      assert.equal(existsSync(pdf.render.pages[0]), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
