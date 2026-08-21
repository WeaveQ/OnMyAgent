import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createZipFromDir, extractZipToDir } from "./managed-tools/managed-cli/archive.mjs";
import {
  assertExtractedTreeSafe,
  exportExpertPackageToZip,
  importExpertPackageFromSource,
  listZipEntryNames,
  resolveExpertPackageRoot,
  zipEntryEscapesRoot,
} from "./expert-package-import.mjs";

const execFileAsync = promisify(execFile);

function validateExpertPackageName(value) {
  const normalized = String(value ?? "").trim();
  if (
    !normalized ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized === "." ||
    normalized === ".."
  ) {
    throw new Error("Invalid expert package");
  }
  return normalized;
}

async function pathExists(target) {
  return stat(target).then(() => true).catch(() => false);
}

async function writeMinimalPackage(packageDir, packageName = path.basename(packageDir)) {
  await mkdir(path.join(packageDir, ".expert-plugin"), { recursive: true });
  await mkdir(path.join(packageDir, "knowledge"), { recursive: true });
  await writeFile(
    path.join(packageDir, ".expert-plugin", "plugin.json"),
    `${JSON.stringify({ name: packageName, skills: ["demo-skill"] }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(packageDir, "README.md"), `# ${packageName}\n`, "utf8");
  await writeFile(path.join(packageDir, "knowledge", "note.md"), "context\n", "utf8");
}

function importDeps(root) {
  return {
    marketplaceRoot: path.join(root, "my-experts"),
    validateExpertPackageName,
    pathExists,
    mkdir,
    rm,
    cp,
    extractZipToDir,
    createZipFromDir,
    listZipEntries: listZipEntryNames,
    listDeclaredSkills: async (packageDir) => {
      const raw = await readFile(path.join(packageDir, ".expert-plugin", "plugin.json"), "utf8");
      const plugin = JSON.parse(raw);
      return Array.isArray(plugin.skills) ? plugin.skills : [];
    },
  };
}

function exportDeps(root) {
  return {
    marketplaceRoot: path.join(root, "my-experts"),
    validateExpertPackageName,
    pathExists,
    mkdir,
    createZipFromDir,
  };
}

test("resolveExpertPackageRoot accepts a wrapped folder with plugin.json", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-root-"));
  try {
    const nested = path.join(root, "review-helper");
    await writeMinimalPackage(nested);
    assert.equal(await resolveExpertPackageRoot(nested, { pathExists }), nested);
    assert.equal(await resolveExpertPackageRoot(root, { pathExists }), nested);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("importExpertPackageFromSource copies a folder into my-experts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-import-"));
  try {
    const source = path.join(root, "source", "review-helper");
    await writeMinimalPackage(source);
    const result = await importExpertPackageFromSource({
      sourcePath: source,
      ...importDeps(root),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.packageName, "review-helper");
      assert.equal(result.marketplace, "my-experts");
      assert.deepEqual(result.declaredSkills, ["demo-skill"]);
      assert.equal(
        await readFile(path.join(root, "my-experts", "review-helper", "knowledge", "note.md"), "utf8"),
        "context\n",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("importExpertPackageFromSource refuses overwrite unless requested", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-exists-"));
  try {
    const source = path.join(root, "source", "review-helper");
    await writeMinimalPackage(source);
    const deps = { sourcePath: source, ...importDeps(root) };
    const first = await importExpertPackageFromSource(deps);
    assert.equal(first.ok, true);
    const second = await importExpertPackageFromSource(deps);
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.code, "already_exists");
      assert.equal(second.packageName, "review-helper");
    }
    await writeFile(path.join(source, "knowledge", "note.md"), "updated\n", "utf8");
    const overwritten = await importExpertPackageFromSource({ ...deps, overwrite: true });
    assert.equal(overwritten.ok, true);
    assert.equal(
      await readFile(path.join(root, "my-experts", "review-helper", "knowledge", "note.md"), "utf8"),
      "updated\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("importExpertPackageFromSource can keep the original and install a copy", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-copy-"));
  try {
    const source = path.join(root, "source", "review-helper");
    await writeMinimalPackage(source);
    const deps = { sourcePath: source, ...importDeps(root) };
    const first = await importExpertPackageFromSource(deps);
    assert.equal(first.ok, true);
    const copied = await importExpertPackageFromSource({ ...deps, asCopy: true });
    assert.equal(copied.ok, true);
    if (copied.ok) {
      assert.equal(copied.packageName, "review-helper-copy");
      assert.equal(
        await readFile(path.join(root, "my-experts", "review-helper", "knowledge", "note.md"), "utf8"),
        "context\n",
      );
      assert.equal(
        await readFile(path.join(root, "my-experts", "review-helper-copy", "knowledge", "note.md"), "utf8"),
        "context\n",
      );
      const plugin = JSON.parse(
        await readFile(
          path.join(root, "my-experts", "review-helper-copy", ".expert-plugin", "plugin.json"),
          "utf8",
        ),
      );
      assert.equal(plugin.name, "review-helper-copy");
    }
    const copiedAgain = await importExpertPackageFromSource({ ...deps, asCopy: true });
    assert.equal(copiedAgain.ok, true);
    if (copiedAgain.ok) {
      assert.equal(copiedAgain.packageName, "review-helper-copy-2");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("importExpertPackageFromSource installs from a zip archive", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-zip-"));
  try {
    const packageDir = path.join(root, "review-helper");
    await writeMinimalPackage(packageDir);
    const zipPath = path.join(root, "review-helper.zip");
    await execFileAsync("zip", ["-r", zipPath, "review-helper"], { cwd: root });
    const result = await importExpertPackageFromSource({
      sourcePath: zipPath,
      ...importDeps(root),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.packageName, "review-helper");
      assert.equal(
        await readFile(path.join(root, "my-experts", "review-helper", "README.md"), "utf8"),
        "# review-helper\n",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exportExpertPackageToZip fails when the package is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-export-missing-"));
  try {
    const result = await exportExpertPackageToZip({
      packageName: "review-helper",
      destPath: path.join(root, "out.zip"),
      ...exportDeps(root),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "not_found");
      assert.equal(result.packageName, "review-helper");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("export then import round-trips plugin.json and knowledge bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-roundtrip-"));
  try {
    const packageDir = path.join(root, "my-experts", "review-helper");
    await writeMinimalPackage(packageDir);
    const destPath = path.join(root, "portable", "review-helper.zip");
    const exported = await exportExpertPackageToZip({
      packageName: "review-helper",
      destPath,
      ...exportDeps(root),
    });
    assert.equal(exported.ok, true);
    if (exported.ok) {
      assert.equal(exported.packageName, "review-helper");
      assert.equal(exported.marketplace, "my-experts");
      assert.equal(path.extname(exported.destPath), ".zip");
    }

    const importRoot = path.join(root, "import-target");
    const imported = await importExpertPackageFromSource({
      sourcePath: destPath,
      ...importDeps(importRoot),
    });
    assert.equal(imported.ok, true);
    if (imported.ok) {
      assert.equal(imported.packageName, "review-helper");
      assert.equal(imported.marketplace, "my-experts");
      assert.equal(imported.displayName, "review-helper");
      const copied = path.join(importRoot, "my-experts", "review-helper");
      assert.equal(
        await readFile(path.join(copied, ".expert-plugin", "plugin.json"), "utf8"),
        await readFile(path.join(packageDir, ".expert-plugin", "plugin.json"), "utf8"),
      );
      assert.equal(
        await readFile(path.join(copied, "knowledge", "note.md"), "utf8"),
        "context\n",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("assertExtractedTreeSafe rejects files that escape the extract root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-escape-"));
  try {
    const outside = path.join(root, "outside.txt");
    await writeFile(outside, "nope\n", "utf8");
    const extractDir = path.join(root, "extract");
    await mkdir(extractDir, { recursive: true });
    const { symlink } = await import("node:fs/promises");
    await symlink(outside, path.join(extractDir, "escaped.txt"));
    await assert.rejects(() => assertExtractedTreeSafe(extractDir), /outside the archive root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zipEntryEscapesRoot rejects parent and absolute entries before extract", () => {
  assert.equal(zipEntryEscapesRoot("review-helper/.expert-plugin/plugin.json"), false);
  assert.equal(zipEntryEscapesRoot("../etc/passwd"), true);
  assert.equal(zipEntryEscapesRoot("/tmp/evil"), true);
});

test("importExpertPackageFromSource uses plugin.json name when the zip root is the package", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-ziproot-"));
  try {
    const pack = path.join(root, "pack");
    await writeMinimalPackage(pack, "review-helper");
    const zipPath = path.join(root, "review-helper.zip");
    await execFileAsync("zip", ["-r", zipPath, "."], { cwd: pack });
    const imported = await importExpertPackageFromSource({
      sourcePath: zipPath,
      ...importDeps(root),
    });
    assert.equal(imported.ok, true);
    if (imported.ok) {
      assert.equal(imported.packageName, "review-helper");
      assert.deepEqual(imported.missingSkills, ["demo-skill"]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("importExpertPackageFromSource refuses to overwrite a live source folder", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-self-"));
  try {
    const packageDir = path.join(root, "my-experts", "review-helper");
    await writeMinimalPackage(packageDir);
    const result = await importExpertPackageFromSource({
      sourcePath: packageDir,
      overwrite: true,
      ...importDeps(root),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_package");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("importExpertPackageFromSource rejects zip entries that escape before extract", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-ziplist-"));
  try {
    const source = path.join(root, "source", "review-helper");
    await writeMinimalPackage(source);
    const zipPath = path.join(root, "evil.zip");
    await execFileAsync("zip", ["-r", zipPath, "review-helper"], {
      cwd: path.join(root, "source"),
    });
    const result = await importExpertPackageFromSource({
      sourcePath: zipPath,
      ...importDeps(root),
      listZipEntries: async () => ["review-helper/.expert-plugin/plugin.json", "../escape.txt"],
      extractZipToDir: async () => {
        throw new Error("extract must not run");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "path_escape");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
