/**
 * Import / export a portable expert package (zip or directory) for my-experts.
 * Bundled catalog under resources/ is never a destination.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PLUGIN_MARKERS = [
  path.join(".expert-plugin", "plugin.json"),
  path.join(".onmyagent-plugin", "plugin.json"),
];

/**
 * @param {string} root
 * @param {{ pathExists: (target: string) => Promise<boolean> }} io
 */
export async function resolveExpertPackageRoot(root, io) {
  const base = String(root ?? "").trim();
  if (!base) return null;
  for (const marker of PLUGIN_MARKERS) {
    if (await io.pathExists(path.join(base, marker))) return base;
  }
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return null;
  }
  const hits = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const child = path.join(base, entry.name);
    for (const marker of PLUGIN_MARKERS) {
      if (await io.pathExists(path.join(child, marker))) {
        hits.push(child);
        break;
      }
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * @param {string} root
 */
export async function assertExtractedTreeSafe(root) {
  const realRoot = await realpath(root);
  const stack = [realRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      let real;
      try {
        real = await realpath(full);
      } catch {
        continue;
      }
      const relative = path.relative(realRoot, real);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        const error = /** @type {Error & { code?: string }} */ (
          new Error("Expert package contains files outside the archive root")
        );
        error.code = "path_escape";
        throw error;
      }
      if (entry.isDirectory()) stack.push(full);
    }
  }
}

function isZipPath(sourcePath) {
  return sourcePath.toLowerCase().endsWith(".zip");
}

function isPathInside(inner, outer) {
  const child = path.resolve(inner);
  const parent = path.resolve(outer);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

/**
 * @param {string} entry
 */
export function zipEntryEscapesRoot(entry) {
  const normalized = String(entry ?? "").trim().replace(/\\/g, "/");
  if (!normalized) return false;
  if (path.isAbsolute(normalized) || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    return true;
  }
  let depth = 0;
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      depth -= 1;
      if (depth < 0) return true;
      continue;
    }
    depth += 1;
  }
  return false;
}

/**
 * @param {string} archivePath
 * @returns {Promise<string[]>}
 */
export async function listZipEntryNames(archivePath) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", archivePath], {
    maxBuffer: 8 * 1024 * 1024,
  });
  return String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function assertZipArchiveSafe(archivePath, listZipEntries) {
  const entries = await listZipEntries(archivePath);
  for (const entry of entries) {
    if (zipEntryEscapesRoot(entry)) {
      const error = /** @type {Error & { code?: string }} */ (
        new Error("Expert package zip contains path-escaping entries")
      );
      error.code = "path_escape";
      throw error;
    }
  }
}

/**
 * Next free `{name}-copy` / `{name}-copy-N` under my-experts.
 * @param {{
 *   packageName: string,
 *   marketplaceRoot: string,
 *   pathExists: (target: string) => Promise<boolean>,
 *   validateExpertPackageName: (value: unknown) => string,
 * }} input
 */
export async function allocateExpertPackageCopyName(input) {
  const base = String(input.packageName ?? "").trim();
  for (let index = 1; index <= 99; index += 1) {
    const candidate = index === 1 ? `${base}-copy` : `${base}-copy-${index}`;
    let safe;
    try {
      safe = input.validateExpertPackageName(candidate);
    } catch {
      continue;
    }
    if (!safe || safe.startsWith(".")) continue;
    if (!(await input.pathExists(path.join(input.marketplaceRoot, safe)))) {
      return safe;
    }
  }
  throw new Error("Could not allocate a unique expert package copy name");
}

function suffixCopiedDisplayName(value, packageName) {
  if (typeof value === "string" && value.trim()) {
    const current = value.trim();
    return current.toLowerCase().endsWith(" copy") ? current : `${current} copy`;
  }
  if (value && typeof value === "object") {
    const next = { ...value };
    for (const key of Object.keys(next)) {
      const text = String(next[key] ?? "").trim();
      if (!text) continue;
      next[key] = text.toLowerCase().endsWith(" copy") ? text : `${text} copy`;
    }
    return next;
  }
  return `${packageName} copy`;
}

async function retargetCopiedPluginName(packageDir, packageName) {
  for (const marker of PLUGIN_MARKERS) {
    const pluginPath = path.join(packageDir, marker);
    try {
      const plugin = JSON.parse(await readFile(pluginPath, "utf8"));
      if (!plugin || typeof plugin !== "object") continue;
      plugin.name = packageName;
      plugin.displayName = suffixCopiedDisplayName(plugin.displayName, packageName);
      await writeFile(
        pluginPath,
        `${JSON.stringify(plugin, null, 2)}\n`,
        "utf8",
      );
      return;
    } catch {
      // try the next marker
    }
  }
}

function fail(code, message, packageName) {
  return {
    ok: false,
    code,
    message,
    ...(packageName ? { packageName } : {}),
  };
}

function localizedPluginText(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    return String(record.zh ?? record.en ?? "").trim();
  }
  return "";
}

/**
 * Seed registry fields from package plugin.json (definition only).
 * @param {unknown} plugin
 * @param {string} packageName
 */
export function seedFromExpertPlugin(plugin, packageName) {
  const record =
    plugin && typeof plugin === "object" ? /** @type {Record<string, unknown>} */ (plugin) : {};
  const config =
    record.agentConfig && typeof record.agentConfig === "object"
      ? /** @type {Record<string, unknown>} */ (record.agentConfig)
      : {};
  const displayName =
    localizedPluginText(record.profession) ||
    localizedPluginText(record.displayName) ||
    String(record.name ?? "").trim() ||
    packageName;
  const description =
    localizedPluginText(record.displayDescription) ||
    String(record.description ?? "").trim();
  return {
    displayName,
    description,
    rolePrompt: String(config.rolePrompt ?? "").trim(),
    memory: String(config.memory ?? "").trim(),
  };
}

async function readCopiedPackageSeed(packageDir, packageName) {
  for (const marker of PLUGIN_MARKERS) {
    try {
      const raw = await readFile(path.join(packageDir, marker), "utf8");
      return seedFromExpertPlugin(JSON.parse(raw), packageName);
    } catch {
      // try the next marker
    }
  }
  return seedFromExpertPlugin({}, packageName);
}

async function readPluginPackageName(packageDir) {
  for (const marker of PLUGIN_MARKERS) {
    try {
      const parsed = JSON.parse(await readFile(path.join(packageDir, marker), "utf8"));
      const plugin =
        parsed && typeof parsed === "object"
          ? /** @type {Record<string, unknown>} */ (parsed)
          : {};
      const name = String(plugin.name ?? "").trim();
      if (name) return name;
    } catch {
      // try the next marker
    }
  }
  return "";
}

function catchPathEscape(error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(/** @type {{ code?: unknown }} */ (error).code ?? "")
      : "";
  return code === "path_escape";
}

/**
 * @param {{
 *   sourcePath: string,
 *   overwrite?: boolean,
 *   asCopy?: boolean,
 *   marketplaceRoot: string,
 *   validateExpertPackageName: (value: unknown) => string,
 *   pathExists: (target: string) => Promise<boolean>,
 *   mkdir: typeof import("node:fs/promises").mkdir,
 *   rm: typeof import("node:fs/promises").rm,
 *   cp: typeof import("node:fs/promises").cp,
 *   extractZipToDir: (input: { archivePath: string, destDir: string }) => Promise<void>,
 *   listZipEntries?: (archivePath: string) => Promise<string[]>,
 *   listDeclaredSkills?: (packageDir: string) => Promise<string[]>,
 *   listBundledSkillNames?: (packageDir: string) => Promise<string[]>,
 * }} input
 */
export async function importExpertPackageFromSource(input) {
  const sourcePath = String(input.sourcePath ?? "").trim();
  if (!sourcePath) return fail("not_found", "Expert package path is required");

  let sourceStat;
  try {
    sourceStat = await stat(sourcePath);
  } catch {
    return fail("not_found", "Expert package was not found");
  }

  let workDir = sourcePath;
  let extractDir = null;
  let staging = "";
  try {
    if (sourceStat.isFile()) {
      if (!isZipPath(sourcePath)) {
        return fail("invalid_package", "Expert package must be a folder or a .zip archive");
      }
      extractDir = await mkdtemp(path.join(tmpdir(), "onmyagent-expert-import-"));
      try {
        await assertZipArchiveSafe(sourcePath, input.listZipEntries ?? listZipEntryNames);
        await input.extractZipToDir({ archivePath: sourcePath, destDir: extractDir });
        await assertExtractedTreeSafe(extractDir);
      } catch (error) {
        if (catchPathEscape(error)) {
          return fail("path_escape", "Expert package contains files outside the archive root");
        }
        throw error;
      }
      const resolved = await resolveExpertPackageRoot(extractDir, input);
      if (!resolved) return fail("invalid_package", "Zip is missing .expert-plugin/plugin.json");
      workDir = resolved;
    } else if (sourceStat.isDirectory()) {
      const resolved = await resolveExpertPackageRoot(sourcePath, input);
      if (!resolved) {
        return fail("invalid_package", "Folder is missing .expert-plugin/plugin.json");
      }
      try {
        await assertExtractedTreeSafe(resolved);
      } catch (error) {
        if (catchPathEscape(error)) {
          return fail("path_escape", "Expert package contains files outside the archive root");
        }
        throw error;
      }
      workDir = resolved;
    } else {
      return fail("invalid_package", "Expert package must be a folder or a .zip archive");
    }

    const pluginName = await readPluginPackageName(workDir);
    const folderName = path.basename(workDir);
    const rawName =
      pluginName ||
      (folderName.startsWith("onmyagent-expert-import-") ? "" : folderName);
    let packageName;
    try {
      packageName = input.validateExpertPackageName(rawName);
    } catch {
      return fail("invalid_package", "Expert package name is invalid");
    }
    if (!packageName || packageName.startsWith(".")) {
      return fail("invalid_package", "Expert package name is invalid");
    }

    await input.mkdir(input.marketplaceRoot, { recursive: true });
    let destination = path.join(input.marketplaceRoot, packageName);
    if (isPathInside(workDir, destination) || isPathInside(destination, workDir)) {
      return fail(
        "invalid_package",
        "Cannot import a live my-experts folder onto itself",
        packageName,
      );
    }
    const exists = await input.pathExists(destination);
    if (exists && input.overwrite !== true && input.asCopy !== true) {
      return fail("already_exists", "An expert with this package name already exists", packageName);
    }
    if (exists && input.asCopy === true && input.overwrite !== true) {
      packageName = await allocateExpertPackageCopyName({
        packageName,
        marketplaceRoot: input.marketplaceRoot,
        pathExists: input.pathExists,
        validateExpertPackageName: input.validateExpertPackageName,
      });
      destination = path.join(input.marketplaceRoot, packageName);
    }
    staging = `${destination}.import-tmp`;
    await input.rm(staging, { recursive: true, force: true });
    await input.cp(workDir, staging, { recursive: true });
    if (input.overwrite === true) {
      await input.rm(destination, { recursive: true, force: true });
    }
    await input.rm(destination, { recursive: true, force: true }).catch(() => undefined);
    await rename(staging, destination);
    if (input.asCopy === true && input.overwrite !== true) {
      await retargetCopiedPluginName(destination, packageName);
    }
    const declaredSkills =
      typeof input.listDeclaredSkills === "function"
        ? await input.listDeclaredSkills(destination)
        : [];
    const bundledSkills =
      typeof input.listBundledSkillNames === "function"
        ? await input.listBundledSkillNames(destination)
        : [];
    const bundled = new Set(bundledSkills);
    const missingSkills = declaredSkills.filter((name) => !bundled.has(name));
    const seed = await readCopiedPackageSeed(destination, packageName);
    return {
      ok: true,
      path: destination,
      packageName,
      marketplace: "my-experts",
      declaredSkills,
      missingSkills,
      ...seed,
    };
  } catch (error) {
    if (catchPathEscape(error)) {
      return fail(
        "path_escape",
        error instanceof Error ? error.message : "Expert package contains files outside the archive root",
      );
    }
    throw error;
  } finally {
    if (extractDir) {
      await input.rm(extractDir, { recursive: true, force: true });
    }
    if (staging) {
      await input.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Zip `my-experts/{packageName}` to destPath. The archive wraps the package
 * folder so the import helper accepts it.
 *
 * @param {{
 *   packageName: string,
 *   destPath: string,
 *   marketplaceRoot: string,
 *   validateExpertPackageName: (value: unknown) => string,
 *   pathExists: (target: string) => Promise<boolean>,
 *   mkdir: typeof import("node:fs/promises").mkdir,
 *   createZipFromDir: (input: { sourceDir: string, destPath: string }) => Promise<void>,
 * }} input
 */
export async function exportExpertPackageToZip(input) {
  let destPath = String(input.destPath ?? "").trim();
  if (!destPath) return fail("invalid_package", "Export destination is required");
  if (!destPath.toLowerCase().endsWith(".zip")) destPath = `${destPath}.zip`;

  let packageName;
  try {
    packageName = input.validateExpertPackageName(input.packageName);
  } catch {
    return fail("invalid_package", "Expert package name is invalid");
  }
  if (!packageName || packageName.startsWith(".")) {
    return fail("invalid_package", "Expert package name is invalid");
  }

  const sourceDir = path.join(input.marketplaceRoot, packageName);
  if (!(await input.pathExists(sourceDir))) {
    return fail("not_found", "Expert package was not found", packageName);
  }
  const hasPlugin =
    (await input.pathExists(path.join(sourceDir, PLUGIN_MARKERS[0]))) ||
    (await input.pathExists(path.join(sourceDir, PLUGIN_MARKERS[1])));
  if (!hasPlugin) {
    return fail("invalid_package", "Folder is missing .expert-plugin/plugin.json", packageName);
  }

  const resolvedDest = path.resolve(destPath);
  await input.mkdir(path.dirname(resolvedDest), { recursive: true });
  await input.createZipFromDir({ sourceDir, destPath: resolvedDest });
  return {
    ok: true,
    destPath: resolvedDest,
    packageName,
    marketplace: "my-experts",
  };
}
