import { readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import type {
  SessionArchiveAgent,
  SessionArchiveSyncProgress,
  SessionArchiveSyncStats,
} from "@onmyagent/types/session-archive";
import type { WorkspaceInfo } from "@onmyagent/types/server";

import { openSessionArchiveStore, type SessionArchiveStore } from "./session-archive.js";
import { findOpenCodeSqliteSource, listOpenCodeSqliteSessions, loadOpenCodeSqliteSession, type OpenCodeSqliteSessionMeta, type OpenCodeSqliteSource } from "./session-archive-sqlite-opencode.js";
import {
  sessionArchiveParserForAgent,
  discoverSessionArchiveSessionFiles,
} from "./session-archive-parser.js";
import { resolveSessionArchiveSourceRoots, resolveSessionArchiveWatchRoots } from "./session-archive-registry.js";

export type SessionArchiveRuntimePaths = {
  root: string;
  dbPath: string;
};

export type SessionArchiveSyncInput = {
  workspace: WorkspaceInfo;
  paths: SessionArchiveRuntimePaths;
  sourceRoots?: SessionArchiveSourceRoot[];
  sourceConfig?: Parameters<typeof resolveSessionArchiveSourceRoots>[0];
  limit?: number;
  mode?: SessionArchiveSyncMode;
  changedPaths?: string[];
  onProgress?: (progress: SessionArchiveSyncProgress) => void;
};

export type SessionArchiveSyncMode = "incremental" | "resync";

export type SessionArchiveSourceRoot = {
  agent: SessionArchiveAgent;
  root: string;
};

export type SessionArchiveWatcher = {
  close: () => void;
  syncNow: (mode?: SessionArchiveSyncMode, changedPaths?: string[]) => Promise<SessionArchiveSyncStats>;
};

export function resolveSessionArchiveRuntimePaths(input: {
  workspace: WorkspaceInfo;
  dataRoot?: string;
}): SessionArchiveRuntimePaths {
  const root = join(
    resolveSessionArchiveDataRoot(input.dataRoot),
    "runtime-state",
    "session-archive",
    "workspaces",
    workspaceStorageKey(input.workspace),
  );
  return { root, dbPath: join(root, "archive.sqlite") };
}

export async function syncSessionArchive(
  input: SessionArchiveSyncInput,
): Promise<SessionArchiveSyncStats> {
  const sourceRoots = input.sourceRoots ?? defaultSessionArchiveSourceRoots(input.sourceConfig);
  const watchRoots = sessionArchiveSyncWatchRoots(sourceRoots);
  const limit = normalizeSyncLimit(input.limit);
  const mode = input.mode ?? "incremental";
  const store = await openSessionArchiveStore({ dbPath: input.paths.dbPath });
  try {
    const candidates: SessionArchiveSyncCandidate[] = [];
    let synced = 0;
    let skipped = 0;
    let failed = 0;
    const warnings: string[] = [];
    input.onProgress?.(progress("discover", { projectsTotal: sourceRoots.length }));
    const changedCandidates = classifyChangedSessionArchivePaths({ sourceRoots, changedPaths: input.changedPaths ?? [] });
    for (const source of sourceRoots) {
      const parser = sessionArchiveParserForAgent(source.agent);
      if (!parser) {
        warnings.push(`No parser for ${source.agent}`);
        continue;
      }
      const files = changedCandidates.length
        ? changedCandidates.filter((candidate) => candidate.source.agent === source.agent && candidate.source.root === source.root).map((candidate) => candidate.file)
        : await discoverSessionArchiveSessionFiles({ agent: source.agent, root: source.root });
      input.onProgress?.(progress("sync", {
        currentProject: source.root,
        projectsTotal: sourceRoots.length,
        sessionsTotal: candidates.length + files.length,
        sessionsDone: synced + skipped + failed,
      }));
      const fileStates = await mapWithConcurrency(files, 8, async (file) => ({ file, fileState: await readFileState(file) }));
      for (const item of fileStates) {
        if (item.status === "fulfilled") {
          candidates.push({ source, parser, file: item.value.file, fileState: item.value.fileState });
        } else {
          failed += 1;
          warnings.push(`${source.agent}:${item.input}: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}`);
        }
      }
    }
    const selected = candidates
      .sort((left, right) => right.fileState.mtime - left.fileState.mtime || left.file.localeCompare(right.file))
      .slice(0, limit ?? undefined);
    for (const candidate of selected) {
      try {
        const existing = store.getSourceFile(candidate.file);
        const skippedFile = store.getSkippedFile(candidate.file);
        if (
          mode === "incremental" &&
          skippedFile &&
          skippedFile.size === candidate.fileState.size &&
          skippedFile.mtime === candidate.fileState.mtime &&
          skippedFile.hash === candidate.fileState.hash
        ) {
          skipped += 1;
          input.onProgress?.(progress("skip", { currentProject: candidate.source.root, projectsTotal: sourceRoots.length, sessionsTotal: selected.length, sessionsDone: synced + skipped + failed }));
          continue;
        }
        if (mode === "incremental" && existing && existing.size === candidate.fileState.size && existing.mtime === candidate.fileState.mtime) {
          const upgraded = await upgradeSkippedSessionArchiveTitle({ store, candidate, existing, workspace: input.workspace });
          if (upgraded) {
            synced += 1;
            input.onProgress?.(progress("sync", { currentProject: candidate.source.root, projectsTotal: sourceRoots.length, sessionsTotal: selected.length, sessionsDone: synced + skipped + failed }));
            continue;
          }
          skipped += 1;
          input.onProgress?.(progress("skip", { currentProject: candidate.source.root, projectsTotal: sourceRoots.length, sessionsTotal: selected.length, sessionsDone: synced + skipped + failed }));
          continue;
        }
        if (mode === "incremental" && existing && existing.hash === candidate.fileState.hash) {
          const upgraded = await upgradeSkippedSessionArchiveTitle({ store, candidate, existing, workspace: input.workspace });
          if (upgraded) {
            synced += 1;
            store.upsertSourceFile({ ...existing, size: candidate.fileState.size, mtime: candidate.fileState.mtime, synced_at: new Date().toISOString() });
            input.onProgress?.(progress("sync", { currentProject: candidate.source.root, projectsTotal: sourceRoots.length, sessionsTotal: selected.length, sessionsDone: synced + skipped + failed }));
            continue;
          }
          skipped += 1;
          store.upsertSourceFile({ ...existing, size: candidate.fileState.size, mtime: candidate.fileState.mtime, synced_at: new Date().toISOString() });
          input.onProgress?.(progress("skip", { currentProject: candidate.source.root, projectsTotal: sourceRoots.length, sessionsTotal: selected.length, sessionsDone: synced + skipped + failed }));
          continue;
        }
        const result = await candidate.parser.parseFile(candidate.file, {
          machine: "local",
          project: input.workspace.name || input.workspace.id,
          sourceMtimeMs: candidate.fileState.mtime,
          sourceHash: candidate.fileState.hash,
          sourceInode: candidate.fileState.ino,
          sourceDevice: candidate.fileState.dev,
        });
        if (!result) {
          skipped += 1;
          store.upsertSkippedFile({
            path: candidate.file,
            agent: candidate.source.agent,
            size: candidate.fileState.size,
            mtime: candidate.fileState.mtime,
            hash: candidate.fileState.hash,
            reason: "parse_empty",
            skipped_at: new Date().toISOString(),
          });
          input.onProgress?.(progress("skip", { currentProject: candidate.source.root, projectsTotal: sourceRoots.length, sessionsTotal: selected.length, sessionsDone: synced + skipped + failed }));
          continue;
        }
        if (store.isSessionExcluded(result.session.id)) {
          skipped += 1;
          warnings.push(`${candidate.source.agent}:${candidate.file}: skipped excluded session ${result.session.id}`);
          input.onProgress?.(progress("skip", { currentProject: candidate.source.root, projectsTotal: sourceRoots.length, sessionsTotal: selected.length, sessionsDone: synced + skipped + failed }));
          continue;
        }
        store.upsertSession(result.session);
        store.replaceSessionMessages(result.session.id, result.messages);
        store.replaceSessionUsageEvents(result.session.id, result.usageEvents);
        store.upsertSourceFile({
          path: candidate.file,
          agent: candidate.source.agent,
          session_id: result.session.id,
          size: candidate.fileState.size,
          mtime: candidate.fileState.mtime,
          hash: candidate.fileState.hash,
          synced_at: new Date().toISOString(),
        });
        store.deleteSkippedFile(candidate.file);
        synced += 1;
        input.onProgress?.(progress("sync", { currentProject: candidate.source.root, projectsTotal: sourceRoots.length, sessionsTotal: selected.length, sessionsDone: synced + skipped + failed, messagesIndexed: result.messages.length }));
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`${candidate.source.agent}:${candidate.file}: ${message}`);
      }
    }
    // OpenCode SQLite parity (cc-switch): merge sessions from `<root>/opencode.db`
    // alongside legacy JSON. Applied after the file candidate loop so its count
    // rolls into synced/skipped/failed and is reported to the caller.
    const opencodeSqliteResult = await syncOpenCodeSqliteSources({
      store,
      sourceRoots,
      mode,
      machine: "local",
      project: input.workspace.name || input.workspace.id,
    });
    synced += opencodeSqliteResult.synced;
    skipped += opencodeSqliteResult.skipped;
    failed += opencodeSqliteResult.failed;
    for (const warning of opencodeSqliteResult.warnings) warnings.push(warning);
    const omittedSessions = Math.max(0, candidates.length - selected.length);
    return {
      total_sessions: selected.length + opencodeSqliteResult.discovered,
      discovered_sessions: candidates.length + opencodeSqliteResult.discovered,
      ...(limit ? { recent_limit: limit, omitted_sessions: omittedSessions } : {}),
      synced,
      skipped,
      failed,
      warnings,
      aborted: false,
    };
  } finally {
    store.close();
  }
}

type SessionArchiveSyncCandidate = {
  source: SessionArchiveSourceRoot;
  parser: NonNullable<ReturnType<typeof sessionArchiveParserForAgent>>;
  file: string;
  fileState: Awaited<ReturnType<typeof readFileState>>;
};

async function upgradeSkippedSessionArchiveTitle(input: {
  store: SessionArchiveStore;
  candidate: SessionArchiveSyncCandidate;
  existing: NonNullable<ReturnType<SessionArchiveStore["getSourceFile"]>>;
  workspace: WorkspaceInfo;
}): Promise<boolean> {
  const current = input.store.getSessionIncludingDeleted(input.existing.session_id);
  if (!current) return false;
  if (!needsSessionArchiveTitleUpgrade(current)) return false;
  const result = await input.candidate.parser.parseFile(input.candidate.file, {
    machine: "local",
    project: input.workspace.name || input.workspace.id,
    sourceMtimeMs: input.candidate.fileState.mtime,
    sourceHash: input.candidate.fileState.hash,
    sourceInode: input.candidate.fileState.ino,
    sourceDevice: input.candidate.fileState.dev,
  });
  if (!result) return false;
  const hasDisplayNameUpgrade = Boolean(result.session.display_name && result.session.display_name !== current.display_name);
  const hasBootstrapTitleFix = !needsSessionArchiveTitleUpgrade(result.session);
  if (!hasDisplayNameUpgrade && !hasBootstrapTitleFix) return false;
  input.store.upsertSession({
    ...result.session,
    deleted_at: current.deleted_at,
  });
  input.store.replaceSessionMessages(result.session.id, result.messages);
  input.store.replaceSessionUsageEvents(result.session.id, result.usageEvents);
  return true;
}

function needsSessionArchiveTitleUpgrade(session: { first_message: string | null; display_name?: string | null }): boolean {
  if (!session.first_message) return false;
  return session.first_message.trim().startsWith("# AGENTS.md instructions") && session.first_message.includes("<INSTRUCTIONS>");
}

export function startSessionArchiveSyncWatcher(input: {
  workspace: WorkspaceInfo;
  paths: SessionArchiveRuntimePaths;
  sourceRoots?: SessionArchiveSourceRoot[];
  sourceConfig?: Parameters<typeof resolveSessionArchiveSourceRoots>[0];
  debounceMs?: number;
  periodicMs?: number;
  limit?: number;
  changedPaths?: string[];
  onProgress?: (progress: SessionArchiveSyncProgress) => void;
}): SessionArchiveWatcher {
  const sourceRoots = input.sourceRoots ?? defaultSessionArchiveSourceRoots(input.sourceConfig);
  const watchRoots = sessionArchiveSyncWatchRoots(sourceRoots);
  const debounceMs = input.debounceMs ?? 750;
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let periodicTimer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<SessionArchiveSyncStats> | null = null;

  let pendingChangedPaths = new Set<string>(input.changedPaths ?? []);

  const syncNow = async (mode: SessionArchiveSyncMode = "incremental", changedPaths: string[] = []) => {
    if (running) return running;
    for (const path of changedPaths) pendingChangedPaths.add(path);
    const pathsForRun = mode === "incremental" ? [...pendingChangedPaths] : [];
    pendingChangedPaths = new Set<string>();
    running = syncSessionArchive({
      workspace: input.workspace,
      paths: input.paths,
      sourceRoots,
      mode,
      limit: input.limit,
      changedPaths: pathsForRun,
      onProgress: input.onProgress,
    }).finally(() => {
      running = null;
    });
    return running;
  };

  const schedule = (path?: string) => {
    if (path) pendingChangedPaths.add(path);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void syncNow("incremental");
    }, debounceMs);
  };

  for (const root of watchRoots) {
    try {
      watchers.push(watch(root.root, { persistent: false, recursive: root.recursive }, (_event, filename) => {
        schedule(filename ? join(root.root, filename.toString()) : root.root);
      }));
    } catch {
      // Missing or unsupported roots are handled by periodic sync.
    }
  }
  if (input.periodicMs && input.periodicMs > 0) {
    periodicTimer = setInterval(() => {
      void syncNow("incremental");
    }, input.periodicMs);
  }

  return {
    close: () => {
      if (timer) clearTimeout(timer);
      if (periodicTimer) clearInterval(periodicTimer);
      for (const watcher of watchers) watcher.close();
    },
    syncNow,
  };
}

export function defaultSessionArchiveSourceRoots(
  config?: Parameters<typeof resolveSessionArchiveSourceRoots>[0],
): SessionArchiveSourceRoot[] {
  return resolveSessionArchiveSourceRoots(config).map((source) => ({ agent: source.agent, root: source.root }));
}

export function sessionArchiveSyncWatchRoots(sourceRoots: SessionArchiveSourceRoot[]) {
  const seen = new Set<string>();
  return sourceRoots.flatMap((source) => resolveSessionArchiveWatchRoots(source)).filter((root) => {
    const key = `${root.agent}\0${root.root}\0${root.recursive ? "recursive" : "shallow"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function classifyChangedSessionArchivePaths(input: {
  sourceRoots: SessionArchiveSourceRoot[];
  changedPaths: string[];
}): Array<{ source: SessionArchiveSourceRoot; file: string }> {
  const seen = new Set<string>();
  const result: Array<{ source: SessionArchiveSourceRoot; file: string }> = [];
  for (const changedPath of input.changedPaths) {
    const absolutePath = resolve(changedPath);
    for (const source of input.sourceRoots) {
      const root = resolve(source.root);
      const relativePath = relative(root, absolutePath);
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) continue;
      for (const file of classifyChangedPathForSource({ source, root, absolutePath, relativePath })) {
        const key = `${source.agent}\0${source.root}\0${file}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ source, file });
      }
    }
  }
  return result;
}

function classifyChangedPathForSource(input: {
  source: SessionArchiveSourceRoot;
  root: string;
  absolutePath: string;
  relativePath: string;
}): string[] {
  const extension = extname(input.absolutePath);
  if (input.source.agent === "codex") {
    if (basename(input.absolutePath) === "session_index.jsonl") return codexSessionFilesNearIndex(input.root);
    return extension === ".jsonl" ? [input.absolutePath] : [];
  }
  if (input.source.agent === "aider") {
    return basename(input.absolutePath) === ".aider.chat.history.md" && !isIgnoredSessionArchivePath(input.relativePath) ? [input.absolutePath] : [];
  }
  if (input.source.agent === "opencode" || input.source.agent === "kilo") {
    return input.relativePath.split(sep).slice(0, 2).join(sep) === join("storage", "session") && extension === ".json" ? [input.absolutePath] : [];
  }
  if (input.source.agent === "mimocode") {
    return input.relativePath.split(sep).slice(0, 2).join(sep) === join("storage", "session_diff") && extension === ".json" ? [input.absolutePath] : [];
  }
  if (input.source.agent === "openclaw" || input.source.agent === "qclaw") {
    return input.relativePath.split(sep).includes("sessions") && extension === ".jsonl" ? [input.absolutePath] : [];
  }
  if (input.source.agent === "kimi") return basename(input.absolutePath) === "wire.jsonl" ? [input.absolutePath] : [];
  if (input.source.agent === "qwen") return input.relativePath.split(sep).includes("chats") && extension === ".jsonl" ? [input.absolutePath] : [];
  if (input.source.agent === "kiro") return input.relativePath.split(sep).length === 1 && extension === ".jsonl" ? [input.absolutePath] : [];
  if (input.source.agent === "hermes") return extension === ".jsonl" || extension === ".json" ? [input.absolutePath] : [];
  return extension === ".jsonl" || extension === ".json" ? [input.absolutePath] : [];
}

function codexSessionFilesNearIndex(root: string): string[] {
  const sessions = [join(root, "sessions"), join(root, "archived_sessions")];
  return sessions.flatMap((dir) => walkFilesSyncSafe(dir));
}

function walkFilesSyncSafe(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      let info: ReturnType<typeof statSync>;
      try {
        info = statSync(path);
      } catch {
        continue;
      }
      if (info.isDirectory()) visit(path);
      else if (info.isFile() && extname(path) === ".jsonl" && basename(path) !== "session_index.jsonl") files.push(path);
    }
  };
  visit(root);
  return files;
}

function isIgnoredSessionArchivePath(path: string): boolean {
  return path.split(sep).some((part) => ["node_modules", ".git", "vendor", "dist", "build"].includes(part));
}

async function mapWithConcurrency<Input, Output>(
  values: Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<Array<{ status: "fulfilled"; input: Input; value: Output } | { status: "rejected"; input: Input; reason: unknown }>> {
  const output: Array<{ status: "fulfilled"; input: Input; value: Output } | { status: "rejected"; input: Input; reason: unknown }> = [];
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, values.length)) }, async () => {
    while (index < values.length) {
      const current = values[index];
      index += 1;
      try {
        output.push({ status: "fulfilled", input: current, value: await mapper(current) });
      } catch (error) {
        output.push({ status: "rejected", input: current, reason: error });
      }
    }
  });
  await Promise.all(workers);
  return output;
}

function resolveSessionArchiveDataRoot(dataRoot?: string): string {
  const override = dataRoot?.trim() || process.env.ONMYAGENT_DATA_DIR?.trim();
  if (override) return override;
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "com.differentai.onmyagent.dev");
  }
  return join(homedir(), ".onmyagent");
}

function workspaceStorageKey(workspace: WorkspaceInfo): string {
  const stable = workspace.id.trim() || workspace.path;
  return stable.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "workspace";
}

function normalizeSyncLimit(value: number | undefined): number | null {
  if (value === undefined || value <= 0) return null;
  if (!Number.isFinite(value)) return null;
  return Math.min(20_000, Math.floor(value));
}

async function readFileState(path: string) {
  const [info, content] = await Promise.all([stat(path), readFile(path)]);
  return {
    size: info.size,
    mtime: info.mtimeMs,
    ino: info.ino,
    dev: info.dev,
    hash: createHash("sha256").update(content).digest("hex"),
  };
}

function progress(phase: string, values: {
  currentProject?: string;
  projectsTotal?: number;
  projectsDone?: number;
  sessionsTotal?: number;
  sessionsDone?: number;
  messagesIndexed?: number;
} = {}): SessionArchiveSyncProgress {
  return {
    phase,
    ...(values.currentProject ? { current_project: values.currentProject } : {}),
    projects_total: values.projectsTotal ?? 0,
    projects_done: values.projectsDone ?? 0,
    sessions_total: values.sessionsTotal ?? 0,
    sessions_done: values.sessionsDone ?? 0,
    messages_indexed: values.messagesIndexed ?? 0,
  };
}

type OpenCodeSqliteSyncResult = {
  discovered: number;
  synced: number;
  skipped: number;
  failed: number;
  warnings: string[];
};

async function syncOpenCodeSqliteSources(input: {
  store: SessionArchiveStore;
  sourceRoots: SessionArchiveSourceRoot[];
  mode: SessionArchiveSyncMode;
  machine: string;
  project: string;
}): Promise<OpenCodeSqliteSyncResult> {
  const result: OpenCodeSqliteSyncResult = { discovered: 0, synced: 0, skipped: 0, failed: 0, warnings: [] };
  const seen = new Set<string>();
  for (const source of input.sourceRoots) {
    if (source.agent !== "opencode") continue;
    const sqliteSource = findOpenCodeSqliteSource(source.root);
    if (!sqliteSource) continue;
    if (seen.has(sqliteSource.dbPath)) continue;
    seen.add(sqliteSource.dbPath);
    let metas: OpenCodeSqliteSessionMeta[];
    try {
      metas = listOpenCodeSqliteSessions(sqliteSource);
    } catch (error) {
      result.failed += 1;
      result.warnings.push(`opencode:${sqliteSource.dbPath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    result.discovered += metas.length;
    for (const meta of metas) {
      try {
        const applied = await upsertOpenCodeSqliteSession({
          store: input.store,
          source: sqliteSource,
          meta,
          mode: input.mode,
          machine: input.machine,
          project: input.project,
        });
        if (applied === "synced") result.synced += 1;
        else if (applied === "skipped") result.skipped += 1;
      } catch (error) {
        result.failed += 1;
        result.warnings.push(`opencode:${meta.sourceKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return result;
}

async function upsertOpenCodeSqliteSession(input: {
  store: SessionArchiveStore;
  source: OpenCodeSqliteSource;
  meta: OpenCodeSqliteSessionMeta;
  mode: SessionArchiveSyncMode;
  machine: string;
  project: string;
}): Promise<"synced" | "skipped"> {
  const existing = input.store.getSourceFile(input.meta.sourceKey);
  if (input.mode === "incremental" && existing && existing.mtime === input.meta.timeUpdated) {
    return "skipped";
  }
  const parsed = loadOpenCodeSqliteSession({
    source: input.source,
    session: input.meta,
    machine: input.machine,
    project: input.project,
  });
  if (!parsed) {
    input.store.upsertSkippedFile({
      path: input.meta.sourceKey,
      agent: "opencode",
      size: 0,
      mtime: input.meta.timeUpdated,
      hash: input.meta.sourceKey,
      reason: "parse_empty",
      skipped_at: new Date().toISOString(),
    });
    return "skipped";
  }
  input.store.upsertSession(parsed.session);
  input.store.replaceSessionMessages(parsed.session.id, parsed.messages);
  input.store.replaceSessionUsageEvents(parsed.session.id, parsed.usageEvents);
  input.store.upsertSourceFile({
    path: input.meta.sourceKey,
    agent: "opencode",
    session_id: parsed.session.id,
    size: 0,
    mtime: input.meta.timeUpdated,
    hash: input.meta.sourceKey,
    synced_at: new Date().toISOString(),
  });
  return "synced";
}

