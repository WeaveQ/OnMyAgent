/**
 * OpenCode config + command file helpers used by desktop IPC (opencode domain).
 */
import path from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";

import {
  execResult,
  resolveCommandsDir as resolveCommandsDirPure,
  resolveOpencodeConfigPath as resolveOpencodeConfigPathPure,
} from "./desktop-main-helpers.mjs";
import {
  sanitizeCommandName,
  serializeCommandFrontmatter,
} from "./desktop-workspace-ids.mjs";

/**
 * @param {{
 *   globalOpencodeRoot?: () => string,
 *   pathExists?: (p: string) => Promise<boolean>,
 *   isDirectory?: (p: string) => Promise<boolean>,
 * }} [options]
 */
export function createOpencodeWorkspaceFiles(options = {}) {
  const globalOpencodeRoot = options.globalOpencodeRoot;
  const pathExists = options.pathExists;
  const isDirectory = options.isDirectory;

  if (typeof globalOpencodeRoot !== "function") {
    throw new Error("createOpencodeWorkspaceFiles requires globalOpencodeRoot");
  }
  if (typeof pathExists !== "function") {
    throw new Error("createOpencodeWorkspaceFiles requires pathExists");
  }
  if (typeof isDirectory !== "function") {
    throw new Error("createOpencodeWorkspaceFiles requires isDirectory");
  }

  function resolveOpencodeConfigPath(scope, projectDir) {
    return resolveOpencodeConfigPathPure(scope, projectDir, globalOpencodeRoot());
  }

  async function readOpencodeConfig(scope, projectDir) {
    const { jsoncPath, jsonPath } = resolveOpencodeConfigPath(scope, projectDir);
    const chosenPath = (await pathExists(jsoncPath))
      ? jsoncPath
      : (await pathExists(jsonPath))
        ? jsonPath
        : jsoncPath;
    const exists = await pathExists(chosenPath);
    return {
      path: chosenPath,
      exists,
      content: exists ? await readFile(chosenPath, "utf8") : null,
    };
  }

  async function writeOpencodeConfig(scope, projectDir, content) {
    const { jsoncPath, jsonPath } = resolveOpencodeConfigPath(scope, projectDir);
    const targetPath = (await pathExists(jsoncPath))
      ? jsoncPath
      : (await pathExists(jsonPath))
        ? jsonPath
        : jsoncPath;
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, "utf8");
    return execResult(true, `Wrote ${targetPath}`);
  }

  function resolveCommandsDir(scope, projectDir) {
    return resolveCommandsDirPure(scope, projectDir, globalOpencodeRoot());
  }

  async function listCommandNames(scope, projectDir) {
    const commandsDir = resolveCommandsDir(scope, projectDir);
    if (!(await isDirectory(commandsDir))) {
      return [];
    }
    const entries = await readdir(commandsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name.replace(/\.md$/, ""))
      .sort();
  }

  async function writeCommandFile(scope, projectDir, command) {
    const safeName = sanitizeCommandName(command?.name);
    if (!safeName) {
      throw new Error("command.name is required");
    }
    const commandsDir = resolveCommandsDir(scope, projectDir);
    await mkdir(commandsDir, { recursive: true });
    const filePath = path.join(commandsDir, `${safeName}.md`);
    await writeFile(
      filePath,
      serializeCommandFrontmatter({ ...command, name: safeName }),
      "utf8",
    );
    return execResult(true, `Wrote ${filePath}`);
  }

  async function deleteCommandFile(scope, projectDir, name) {
    const safeName = sanitizeCommandName(name);
    if (!safeName) {
      throw new Error("name is required");
    }
    const commandsDir = resolveCommandsDir(scope, projectDir);
    const filePath = path.join(commandsDir, `${safeName}.md`);
    if (await pathExists(filePath)) {
      await rm(filePath, { force: true });
    }
    return execResult(true, `Deleted ${filePath}`);
  }

  return {
    resolveOpencodeConfigPath,
    readOpencodeConfig,
    writeOpencodeConfig,
    resolveCommandsDir,
    listCommandNames,
    writeCommandFile,
    deleteCommandFile,
  };
}
