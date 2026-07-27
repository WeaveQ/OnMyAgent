import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_TEXT_FILE_BYTES = 2_000_000;
const MAX_RECURSIVE_ITEMS = 10_000;

function resolveWorkspaceTarget(workspacePath, relativePath = "") {
  const root = path.resolve(String(workspacePath || ""));
  const target = path.resolve(root, String(relativePath || ""));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Workspace file path is outside the selected directory.");
  }
  return { root, target };
}

function toPosixRelative(relativePath, name) {
  const base = String(relativePath || "")
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
  return base ? `${base}/${name}` : name;
}

/**
 * @param {string} dirAbs
 * @param {string} relativePath workspace-relative path of dirAbs
 * @param {{ recursive?: boolean; maxItems?: number }} options
 */
async function listLevel(dirAbs, relativePath, options = {}) {
  const recursive = options.recursive === true;
  const maxItems = options.maxItems ?? MAX_RECURSIVE_ITEMS;
  const entries = await readdir(dirAbs, { withFileTypes: true });
  /** @type {Array<{ name: string; path: string; kind: "file" | "dir"; size: number; mtimeMs: number }>} */
  const items = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    if (items.length >= maxItems) break;

    const itemPath = toPosixRelative(relativePath, entry.name);
    const abs = path.join(dirAbs, entry.name);
    let itemStat;
    try {
      itemStat = await stat(abs);
    } catch {
      continue;
    }
    const kind = entry.isDirectory() || itemStat.isDirectory() ? "dir" : "file";
    items.push({
      name: entry.name,
      path: itemPath,
      kind,
      size: itemStat.size,
      mtimeMs: itemStat.mtimeMs,
    });

    if (recursive && kind === "dir" && items.length < maxItems) {
      const nested = await listLevel(abs, itemPath, {
        recursive: true,
        maxItems: maxItems - items.length,
      });
      items.push(...nested);
    }
  }

  if (!recursive) {
    items.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  } else {
    items.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
      return left.path.localeCompare(right.path);
    });
  }

  return items.slice(0, maxItems);
}

export async function listCodeWorkspaceFiles(input = {}) {
  const relativePath = String(input.relativePath ?? "").trim();
  const recursive = input.recursive === true || input.shallow === false;
  const { target } = resolveWorkspaceTarget(input.workspacePath, relativePath);
  const items = await listLevel(target, relativePath.replaceAll("\\", "/").replace(/^\/+|\/+$/g, ""), {
    recursive,
    maxItems: MAX_RECURSIVE_ITEMS,
  });
  return { items };
}

export async function readCodeWorkspaceFile(input = {}) {
  const relativePath = String(input.relativePath ?? "").trim();
  if (!relativePath) throw new Error("Workspace file path is required.");
  const { target } = resolveWorkspaceTarget(input.workspacePath, relativePath);
  const fileStat = await stat(target);
  if (!fileStat.isFile()) throw new Error("Workspace file is not a file.");
  if (fileStat.size > MAX_TEXT_FILE_BYTES) {
    throw new Error("File is too large to preview.");
  }
  const content = await readFile(target, "utf8");
  return {
    path: relativePath,
    content,
    bytes: fileStat.size,
    updatedAt: fileStat.mtimeMs,
  };
}
