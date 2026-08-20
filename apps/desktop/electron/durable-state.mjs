/**
 * Small durable-state primitive for desktop-owned runtime files.
 *
 * The registry keeps the path and write policy in one place: writes are
 * serialized per file, replace the target atomically, and default to private
 * permissions because runtime state commonly contains tokens or identifiers.
 */
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const writeQueues = new Map();

function privateDirectoryMode(mode) {
  return Number.isInteger(mode) ? mode : 0o700;
}

function privateFileMode(mode) {
  return Number.isInteger(mode) ? mode : 0o600;
}

function queueFor(targetPath, operation) {
  const previous = writeQueues.get(targetPath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  writeQueues.set(targetPath, current);
  return current.finally(() => {
    if (writeQueues.get(targetPath) === current) writeQueues.delete(targetPath);
  });
}

async function writeAtomic(targetPath, content, options = {}) {
  const directory = path.dirname(targetPath);
  const directoryMode = privateDirectoryMode(options.directoryMode);
  const fileMode = privateFileMode(options.fileMode);
  await mkdir(directory, { recursive: true, mode: directoryMode });
  await chmod(directory, directoryMode).catch(() => undefined);
  const temporaryPath = `${targetPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: fileMode, flag: "wx" });
    await chmod(temporaryPath, fileMode).catch(() => undefined);
    await rename(temporaryPath, targetPath);
    await chmod(targetPath, fileMode).catch(() => undefined);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export function createDurableJsonStore(targetPath, options = {}) {
  const filePath = String(targetPath ?? "").trim();
  if (!filePath) throw new Error("durable state path is required");
  const directoryMode = privateDirectoryMode(options.directoryMode);
  const fileMode = privateFileMode(options.fileMode);

  return {
    path: filePath,
    async read(fallback = null) {
      try {
        return JSON.parse(await readFile(filePath, "utf8"));
      } catch {
        return fallback;
      }
    },
    async write(value) {
      const content = `${JSON.stringify(value, null, 2)}\n`;
      JSON.parse(content);
      return queueFor(filePath, () => writeAtomic(filePath, content, { directoryMode, fileMode }));
    },
    async appendLines(values) {
      const rows = Array.isArray(values) ? values : [];
      if (rows.length === 0) return;
      const content = `${rows.map((value) => JSON.stringify(value)).join("\n")}\n`;
      await queueFor(filePath, async () => {
        await mkdir(path.dirname(filePath), { recursive: true, mode: directoryMode });
        await chmod(path.dirname(filePath), directoryMode).catch(() => undefined);
        await appendFile(filePath, content, { encoding: "utf8", mode: fileMode });
        await chmod(filePath, fileMode).catch(() => undefined);
      });
    },
  };
}

const DURABLE_SENSITIVITIES = new Set(["public", "private", "secret"]);

function copyDefault(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeRegistryDefinition(name, rootDir, definition = {}) {
  const owner = String(definition.owner ?? "").trim();
  if (!owner) throw new Error(`durable state owner is required for ${name}`);
  const schemaVersion = Number(definition.schemaVersion ?? 1);
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error(`durable state schemaVersion is invalid for ${name}`);
  }
  const sensitivity = String(definition.sensitivity ?? "private");
  if (!DURABLE_SENSITIVITIES.has(sensitivity)) {
    throw new Error(`durable state sensitivity is invalid for ${name}`);
  }
  const ttlMs = definition.ttlMs == null ? null : Number(definition.ttlMs);
  if (ttlMs !== null && (!Number.isSafeInteger(ttlMs) || ttlMs < 0)) {
    throw new Error(`durable state ttlMs is invalid for ${name}`);
  }
  const fileName = String(definition.fileName ?? `${name}.json`).trim();
  if (!fileName || path.isAbsolute(fileName) || fileName.includes("..")) {
    throw new Error(`durable state fileName is invalid for ${name}`);
  }
  const targetPath = path.join(rootDir, fileName);
  return Object.freeze({
    name,
    owner,
    schemaVersion,
    sensitivity,
    ttlMs,
    targetPath,
    defaultValue: definition.defaultValue,
    validate: typeof definition.validate === "function" ? definition.validate : null,
    migrate: typeof definition.migrate === "function" ? definition.migrate : null,
  });
}

/**
 * Versioned registry for desktop-owned JSON state. It does not merge stores
 * from different owners; each entry has an explicit owner, schema version,
 * migration hook, TTL metadata and sensitivity-driven private permissions.
 * @param {{
 *   rootDir?: string,
 *   definitions?: Record<string, {
 *     owner?: string,
 *     schemaVersion?: number,
 *     sensitivity?: string,
 *     ttlMs?: number | null,
 *     fileName?: string,
 *     defaultValue?: unknown,
 *     validate?: (value: unknown, context: { owner: string, schemaVersion: number }) => unknown,
 *     migrate?: (value: unknown, context: { fromVersion: number, toVersion: number, owner: string }) => unknown,
 *   }>,
 * }} options
 */
export function createDurableStateRegistry({ rootDir, definitions = {} } = {}) {
  const resolvedRoot = String(rootDir ?? "").trim();
  if (!resolvedRoot) throw new Error("durable state registry rootDir is required");
  const entries = new Map(Object.entries(definitions).map(([name, definition]) => {
    const normalized = normalizeRegistryDefinition(name, resolvedRoot, definition);
    return [name, normalized];
  }));
  const stores = new Map();

  function entry(name) {
    const normalized = entries.get(String(name));
    if (!normalized) throw new Error(`unknown durable state entry: ${name}`);
    return normalized;
  }

  function store(name) {
    const normalized = entry(name);
    if (!stores.has(normalized.name)) {
      stores.set(normalized.name, createDurableJsonStore(normalized.targetPath, {
        directoryMode: 0o700,
        fileMode: 0o600,
      }));
    }
    return stores.get(normalized.name);
  }

  async function read(name) {
    const normalized = entry(name);
    const current = await store(normalized.name).read(copyDefault(normalized.defaultValue));
    const currentVersion = current && typeof current === "object" && Number.isSafeInteger(Number(current.version))
      ? Number(current.version)
      : 0;
    let value = current;
    if (normalized.migrate && currentVersion < normalized.schemaVersion) {
      value = await normalized.migrate(current, {
        fromVersion: currentVersion,
        toVersion: normalized.schemaVersion,
        owner: normalized.owner,
      });
      await write(normalized.name, value);
    }
    if (normalized.validate) {
      const validated = await normalized.validate(value, { owner: normalized.owner, schemaVersion: normalized.schemaVersion });
      if (validated !== undefined) value = validated;
    }
    return value;
  }

  async function write(name, value) {
    const normalized = entry(name);
    const next = normalized.validate
      ? await normalized.validate(value, { owner: normalized.owner, schemaVersion: normalized.schemaVersion })
      : value;
    return store(normalized.name).write(next === undefined ? value : next);
  }

  async function appendLines(name, values) {
    return store(name).appendLines(values);
  }

  function describe(name) {
    const normalized = entry(name);
    return {
      name: normalized.name,
      owner: normalized.owner,
      schemaVersion: normalized.schemaVersion,
      sensitivity: normalized.sensitivity,
      ttlMs: normalized.ttlMs,
      path: normalized.targetPath,
    };
  }

  return Object.freeze({
    read,
    write,
    appendLines,
    describe,
    entries: () => [...entries.keys()].map((name) => describe(name)),
  });
}

export { writeAtomic as writeDurableFileAtomic };
