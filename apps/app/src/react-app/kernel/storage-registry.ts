/**
 * Renderer storage registry.
 *
 * UI preferences may stay in browser storage, but ownership, schema and
 * retention must be explicit so page components do not invent ad-hoc keys or
 * persist sensitive IPC payloads by accident.
 */

export type BrowserStorageSensitivity = "ui" | "private";

export type BrowserStorageDefinition<T> = {
  key: string;
  owner: string;
  schemaVersion: number;
  sensitivity: BrowserStorageSensitivity;
  ttlMs?: number | null;
  defaultValue: T;
  parse: (value: unknown) => T;
  migrate?: (value: unknown, fromVersion: number) => T;
};

type StoredEnvelope = {
  schemaVersion: number;
  writtenAt: number;
  value: unknown;
};

function cloneDefault<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function isStoredEnvelope(value: unknown): value is StoredEnvelope {
  return value !== null
    && typeof value === "object"
    && "value" in value
    && "schemaVersion" in value
    && "writtenAt" in value
    && Number.isSafeInteger(Number(value.schemaVersion))
    && Number.isFinite(Number(value.writtenAt));
}

export function createBrowserStorageRegistry<const T extends Record<string, unknown>>(
  definitions: { [K in keyof T]: BrowserStorageDefinition<T[K]> },
  storage: Storage | null = typeof window === "undefined" ? null : window.localStorage,
) {
  function definition<K extends keyof T>(name: K): BrowserStorageDefinition<T[K]> {
    const entry = definitions[name];
    if (!entry) throw new Error(`Unknown browser storage entry: ${String(name)}`);
    return entry;
  }

  function read<K extends keyof T>(name: K): T[K] {
    const entry = definition(name);
    if (!storage) return cloneDefault(entry.defaultValue);
    let parsed: unknown;
    try {
      parsed = JSON.parse(storage.getItem(entry.key) ?? "null");
    } catch {
      return cloneDefault(entry.defaultValue);
    }
    const envelope = isStoredEnvelope(parsed)
      ? parsed
      : { schemaVersion: 0, writtenAt: 0, value: parsed };
    if (entry.ttlMs != null && envelope.writtenAt > 0 && Date.now() - envelope.writtenAt > entry.ttlMs) {
      storage.removeItem(entry.key);
      return cloneDefault(entry.defaultValue);
    }
    let value = entry.parse(envelope.value);
    if (envelope.schemaVersion < entry.schemaVersion && entry.migrate) {
      value = entry.migrate(value, envelope.schemaVersion);
      write(name, value);
    }
    return value;
  }

  function write<K extends keyof T>(name: K, value: T[K]): T[K] {
    const entry = definition(name);
    if (storage) {
      const envelope: StoredEnvelope = {
        schemaVersion: entry.schemaVersion,
        writtenAt: Date.now(),
        value,
      };
      storage.setItem(entry.key, JSON.stringify(envelope));
    }
    return value;
  }

  function remove<K extends keyof T>(name: K): void {
    if (storage) storage.removeItem(definition(name).key);
  }

  function describe<K extends keyof T>(name: K) {
    const entry = definition(name);
    return {
      name,
      key: entry.key,
      owner: entry.owner,
      schemaVersion: entry.schemaVersion,
      sensitivity: entry.sensitivity,
      ttlMs: entry.ttlMs ?? null,
    };
  }

  return Object.freeze({ read, write, remove, describe });
}
