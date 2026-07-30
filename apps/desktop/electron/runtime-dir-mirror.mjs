/**
 * Mirror a directory as a symlink/junction, falling back to recursive copy.
 */
import { copyFile, mkdir, readdir, symlink } from "node:fs/promises";
import path from "node:path";

async function copyDirRecursive(sourceDir, targetPath) {
  await mkdir(targetPath, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(src, dst);
    } else if (entry.isSymbolicLink() || entry.isFile()) {
      await copyFile(src, dst);
    }
  }
}

/**
 * Create a directory link (symlink on POSIX, junction on Windows). If the
 * link cannot be created, fall back to recursively copying the directory.
 */
export async function linkOrCopyDir(sourceDir, targetPath) {
  const type = process.platform === "win32" ? "junction" : "dir";
  try {
    await symlink(sourceDir, targetPath, type);
    return { mode: "symlink" };
  } catch (linkError) {
    if (linkError && linkError.code === "EEXIST") {
      return { mode: "existing" };
    }
    try {
      await copyDirRecursive(sourceDir, targetPath);
      return { mode: "copy" };
    } catch (copyError) {
      const detail = linkError?.message ?? String(linkError);
      const nested = copyError?.message ?? String(copyError);
      throw new Error(
        `Failed to mirror ${sourceDir} to ${targetPath}: link=${detail} copy=${nested}`,
      );
    }
  }
}
