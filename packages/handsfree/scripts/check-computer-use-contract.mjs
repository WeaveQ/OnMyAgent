import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(packageRoot, "computer-use-contract.lock.json");

export function contentHash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

export function validateContractSnapshot(contract, files) {
  const errors = [];
  if (contract.schemaVersion !== 1) {
    errors.push(`Unsupported Computer Use contract schema: ${contract.schemaVersion}`);
  }

  for (const [file, expectedHash] of Object.entries(contract.protectedFiles ?? {})) {
    const content = files.get(file);
    if (content === undefined) {
      errors.push(`Protected Computer Use file is missing: ${file}`);
      continue;
    }
    const actualHash = contentHash(content);
    if (actualHash !== expectedHash) {
      errors.push(
        `Protected Computer Use file changed: ${file}\n`
        + `  expected ${expectedHash}\n`
        + `  actual   ${actualHash}`,
      );
    }
  }

  for (const rule of contract.dangerousApiRules ?? []) {
    const allowedFiles = new Set(rule.allowedFiles ?? []);
    for (const [file, content] of files) {
      if (!file.startsWith(`${contract.sourceRoot}/`) || !file.endsWith(".swift")) continue;
      const matcher = new RegExp(rule.pattern, "gm");
      let match;
      while ((match = matcher.exec(content)) !== null) {
        if (!allowedFiles.has(file)) {
          errors.push(
            `Computer Use API boundary violation (${rule.id}): ${file}:${lineNumber(content, match.index)}`,
          );
        }
        if (match[0].length === 0) matcher.lastIndex += 1;
      }
    }
  }

  return errors;
}

async function listFilesRecursively(root, relativeRoot = "") {
  const entries = await readdir(path.join(root, relativeRoot), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(relativeRoot.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(root, relative));
    } else {
      files.push(relative);
    }
  }
  return files;
}

export async function validateComputerUseContract(root = packageRoot) {
  const contract = JSON.parse(await readFile(path.join(root, path.basename(lockPath)), "utf8"));
  const sourceFiles = await listFilesRecursively(root, contract.sourceRoot);
  const requiredFiles = Object.keys(contract.protectedFiles ?? {});
  const paths = new Set([...sourceFiles, ...requiredFiles]);
  const files = new Map();
  await Promise.all([...paths].map(async (file) => {
    try {
      files.set(file, await readFile(path.join(root, file), "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }));
  return {
    contract,
    errors: validateContractSnapshot(contract, files),
    scannedSwiftFiles: sourceFiles.filter((file) => file.endsWith(".swift")).length,
  };
}

async function main() {
  const result = await validateComputerUseContract();
  if (result.errors.length > 0) {
    console.error("Computer Use contract check failed. Do not update the lock just to silence this gate.");
    for (const error of result.errors) console.error(`\n${error}`);
    console.error("\nFollow packages/handsfree/AGENTS.md for an intentional contract change.");
    process.exitCode = 1;
    return;
  }
  console.log(
    `Computer Use contract OK: ${Object.keys(result.contract.protectedFiles).length} protected files, `
    + `${result.scannedSwiftFiles} Swift files scanned.`,
  );
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
  await main();
}
