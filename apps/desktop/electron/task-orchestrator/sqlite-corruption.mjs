import { access, readFile, rename, writeFile } from "node:fs/promises";

export function sqliteCorruptionMarkerPath(dbPath) {
  return `${dbPath}.corruption.json`;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function isSqliteCorruptionError(error) {
  return /not a database|file is not a database|database disk image is malformed|database corruption|quick_check failed|malformed/i
    .test(error instanceof Error ? error.message : String(error));
}

export async function assertNoSqliteCorruptionMarker(dbPath) {
  const markerPath = sqliteCorruptionMarkerPath(dbPath);
  let markerText;
  try {
    markerText = await readFile(markerPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  let preservedPath = "unknown";
  try {
    preservedPath = String(JSON.parse(markerText)?.preservedPath ?? preservedPath);
  } catch {
    // A malformed marker is itself reason to fail closed.
  }
  throw new Error(
    `Task Center SQLite is quarantined after corruption; preserved database: ${preservedPath}. Manual recovery is required before creating a new database.`,
  );
}

async function uniqueSuffix(dbPath, timestamp) {
  const base = `${Math.max(0, Number(timestamp) || Date.now())}-${process.pid}`;
  for (let index = 0; index < 1_000; index += 1) {
    const suffix = index === 0 ? base : `${base}-${index}`;
    if (!await exists(`${dbPath}.corrupt-${suffix}`)) return suffix;
  }
  throw new Error("Unable to allocate a unique Task Center corruption quarantine path");
}

/** Rename the database and WAL sidecars and leave a persistent fail-closed marker. */
export async function preserveCorruptSqliteDatabase({ dbPath, error, timestamp = Date.now() }) {
  const suffix = await uniqueSuffix(dbPath, timestamp);
  const preservedPath = `${dbPath}.corrupt-${suffix}`;
  const markerPath = sqliteCorruptionMarkerPath(dbPath);
  const marker = {
    version: 1,
    originalPath: dbPath,
    preservedPath,
    detectedAt: Math.max(0, Number(timestamp) || Date.now()),
    error: error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000),
  };
  const temporaryMarker = `${markerPath}.${process.pid}.tmp`;
  await writeFile(temporaryMarker, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryMarker, markerPath);

  const renamed = [];
  for (const suffixName of ["", "-wal", "-shm"]) {
    const source = `${dbPath}${suffixName}`;
    if (!await exists(source)) continue;
    const target = `${preservedPath}${suffixName}`;
    await rename(source, target);
    renamed.push(target);
  }
  return { markerPath, preservedPath, renamed };
}
