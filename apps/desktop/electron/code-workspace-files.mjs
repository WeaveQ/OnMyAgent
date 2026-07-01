import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_TEXT_FILE_BYTES = 2_000_000;

function resolveWorkspaceTarget(workspacePath, relativePath = "") {
  const root = path.resolve(String(workspacePath || ""));
  const target = path.resolve(root, String(relativePath || ""));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Workspace file path is outside the selected directory.");
  }
  return { root, target };
}

export async function listCodeWorkspaceFiles(input = {}) {
  const relativePath = String(input.relativePath ?? "").trim();
  const { target } = resolveWorkspaceTarget(input.workspacePath, relativePath);
  const entries = await readdir(target, { withFileTypes: true });
  const items = await Promise.all(
    entries
      .filter((entry) => entry.name !== ".git")
      .map(async (entry) => {
        const itemPath = relativePath
          ? `${relativePath.replaceAll("\\", "/")}/${entry.name}`
          : entry.name;
        const itemStat = await stat(path.join(target, entry.name));
        return {
          name: entry.name,
          path: itemPath,
          kind: entry.isDirectory() ? "dir" : "file",
          size: itemStat.size,
          mtimeMs: itemStat.mtimeMs,
        };
      }),
  );
  items.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
    return left.name.localeCompare(right.name);
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
