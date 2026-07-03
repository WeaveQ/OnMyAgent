import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionArchiveSyncProgress } from "@onmyagent/types/session-archive";
import type { WorkspaceInfo } from "@onmyagent/types/server";

import { openSessionArchiveStore } from "../src/services/session-archive.js";
import {
  classifyChangedSessionArchivePaths,
  sessionArchiveSyncWatchRoots,
  startSessionArchiveSyncWatcher,
  syncSessionArchive,
} from "../src/services/session-archive-sync.js";

describe("session-archive archive sync", () => {
  test("supports incremental hash skip, resync, progress, and source file state", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-sync-"));
    try {
      const workspace = createWorkspace(root);
      const sourceRoot = join(root, "sources");
      await mkdir(sourceRoot, { recursive: true });
      const sourcePath = join(sourceRoot, "rollout-2026-06-11T12-44-06-abc-123.jsonl");
      await writeFile(sourcePath, codexSession("abc-123", "Initial sync"));
      const paths = { root: join(root, "userData", "runtime-state", "session-archive", "workspaces", workspace.id), dbPath: join(root, "archive.sqlite") };
      const progressEvents: SessionArchiveSyncProgress[] = [];

      const first = await syncSessionArchive({
        workspace,
        paths,
        sourceRoots: [{ agent: "codex", root: sourceRoot }],
        onProgress: (event) => progressEvents.push(event),
      });
      expect(first).toMatchObject({ total_sessions: 1, synced: 1, skipped: 0, failed: 0 });
      expect(progressEvents.map((event) => event.phase)).toContain("sync");

      const second = await syncSessionArchive({
        workspace,
        paths,
        sourceRoots: [{ agent: "codex", root: sourceRoot }],
      });
      expect(second).toMatchObject({ total_sessions: 1, synced: 0, skipped: 1, failed: 0 });

      const third = await syncSessionArchive({
        workspace,
        paths,
        sourceRoots: [{ agent: "codex", root: sourceRoot }],
        mode: "resync",
      });
      expect(third).toMatchObject({ total_sessions: 1, synced: 1, skipped: 0, failed: 0 });

      const store = await openSessionArchiveStore({ dbPath: paths.dbPath });
      try {
        expect(store.getSourceFile(sourcePath)).toMatchObject({ path: sourcePath, agent: "codex", session_id: "codex:abc-123" });
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not re-import permanently deleted excluded sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-sync-excluded-"));
    try {
      const workspace = createWorkspace(root);
      const sourceRoot = join(root, "sources");
      await mkdir(sourceRoot, { recursive: true });
      const sourcePath = join(sourceRoot, "rollout-2026-06-11T12-44-06-excluded-1.jsonl");
      await writeFile(sourcePath, codexSession("excluded-1", "Excluded sync"));
      const paths = { root: join(root, "userData", "runtime-state", "session-archive", "workspaces", workspace.id), dbPath: join(root, "archive.sqlite") };

      expect(await syncSessionArchive({ workspace, paths, sourceRoots: [{ agent: "codex", root: sourceRoot }] })).toMatchObject({ synced: 1 });
      const store = await openSessionArchiveStore({ dbPath: paths.dbPath });
      try {
        expect(store.permanentlyDeleteSession("codex:excluded-1")).toBe(true);
        expect(store.isSessionExcluded("codex:excluded-1")).toBe(true);
      } finally {
        store.close();
      }

      const resync = await syncSessionArchive({ workspace, paths, sourceRoots: [{ agent: "codex", root: sourceRoot }], mode: "resync" });
      expect(resync).toMatchObject({ synced: 0, skipped: 1, failed: 0 });
      const reopened = await openSessionArchiveStore({ dbPath: paths.dbPath });
      try {
        expect(reopened.getSessionIncludingDeleted("codex:excluded-1")).toBeNull();
      } finally {
        reopened.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("persists skipped empty parses and resync bypasses the skip cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-sync-skip-cache-"));
    try {
      const workspace = createWorkspace(root);
      const sourceRoot = join(root, "sources");
      await mkdir(sourceRoot, { recursive: true });
      const sourcePath = join(sourceRoot, "rollout-2026-06-11T12-44-06-empty-skip.jsonl");
      await writeFile(sourcePath, [
        JSON.stringify({ type: "session_meta", timestamp: "2024-01-01T10:00:00Z", payload: { id: "empty-skip", cwd: "/tmp/project" } }),
      ].join("\n"));
      const paths = { root: join(root, "userData", "runtime-state", "session-archive", "workspaces", workspace.id), dbPath: join(root, "archive.sqlite") };

      const first = await syncSessionArchive({ workspace, paths, sourceRoots: [{ agent: "codex", root: sourceRoot }] });
      expect(first).toMatchObject({ synced: 0, skipped: 1, failed: 0 });
      const store = await openSessionArchiveStore({ dbPath: paths.dbPath });
      try {
        expect(store.getSkippedFile(sourcePath)).toMatchObject({ path: sourcePath, agent: "codex", reason: "parse_empty" });
      } finally {
        store.close();
      }

      const second = await syncSessionArchive({ workspace, paths, sourceRoots: [{ agent: "codex", root: sourceRoot }] });
      expect(second).toMatchObject({ synced: 0, skipped: 1, failed: 0 });

      const resync = await syncSessionArchive({ workspace, paths, sourceRoots: [{ agent: "codex", root: sourceRoot }], mode: "resync" });
      expect(resync).toMatchObject({ synced: 0, skipped: 1, failed: 0 });

      await writeFile(sourcePath, codexSession("empty-skip", "Now has content"));
      const repaired = await syncSessionArchive({ workspace, paths, sourceRoots: [{ agent: "codex", root: sourceRoot }] });
      expect(repaired).toMatchObject({ synced: 1, skipped: 0, failed: 0 });
      const reopened = await openSessionArchiveStore({ dbPath: paths.dbPath });
      try {
        expect(reopened.getSkippedFile(sourcePath)).toBeNull();
        expect(reopened.getSession("codex:empty-skip")).toMatchObject({ first_message: "Now has content" });
      } finally {
        reopened.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("changed path classifier narrows incremental sync to affected session files", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-changed-paths-"));
    try {
      const workspace = createWorkspace(root);
      const codexRoot = join(root, "codex");
      const sessionDir = join(codexRoot, "sessions", "2026", "06", "24");
      await mkdir(sessionDir, { recursive: true });
      const changedPath = join(sessionDir, "rollout-2026-06-24T10-00-00-changed-1.jsonl");
      const ignoredPath = join(sessionDir, "rollout-2026-06-24T10-01-00-ignored-1.jsonl");
      await writeFile(changedPath, codexSession("changed-1", "Changed path sync"));
      await writeFile(ignoredPath, codexSession("ignored-1", "Should not sync"));
      const paths = { root: join(root, "userData", "runtime-state", "session-archive", "workspaces", workspace.id), dbPath: join(root, "archive.sqlite") };

      expect(classifyChangedSessionArchivePaths({
        sourceRoots: [{ agent: "codex", root: codexRoot }],
        changedPaths: [changedPath],
      })).toEqual([{ source: { agent: "codex", root: codexRoot }, file: changedPath }]);

      const result = await syncSessionArchive({
        workspace,
        paths,
        sourceRoots: [{ agent: "codex", root: codexRoot }],
        changedPaths: [changedPath],
      });

      expect(result).toMatchObject({ total_sessions: 1, discovered_sessions: 1, synced: 1, skipped: 0, failed: 0 });
      const store = await openSessionArchiveStore({ dbPath: paths.dbPath });
      try {
        expect(store.getSession("codex:changed-1")).toMatchObject({ first_message: "Changed path sync" });
        expect(store.getSession("codex:ignored-1")).toBeNull();
      } finally {
        store.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Codex session_index changed path maps to nearby session files", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-codex-index-classifier-"));
    try {
      const codexRoot = join(root, "codex");
      const sessionDir = join(codexRoot, "archived_sessions");
      await mkdir(sessionDir, { recursive: true });
      const sessionPath = join(sessionDir, "rollout-2026-06-24T10-00-00-indexed-1.jsonl");
      const indexPath = join(codexRoot, "session_index.jsonl");
      await writeFile(sessionPath, codexSession("indexed-1", "Indexed session"));
      await writeFile(indexPath, JSON.stringify({ id: "indexed-1", thread_name: "Indexed title" }));

      expect(classifyChangedSessionArchivePaths({
        sourceRoots: [{ agent: "codex", root: codexRoot }],
        changedPaths: [indexPath],
      })).toEqual([{ source: { agent: "codex", root: codexRoot }, file: sessionPath }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("watcher uses registry watch roots for nested OpenCode storage sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-recursive-watch-"));
    try {
      const workspace = createWorkspace(root);
      const openCodeRoot = join(root, "opencode");
      const storageRoot = join(openCodeRoot, "storage");
      const sessionRoot = join(storageRoot, "session", "project-a");
      await mkdir(sessionRoot, { recursive: true });
      const paths = { root: join(root, "userData", "runtime-state", "session-archive", "workspaces", workspace.id), dbPath: join(root, "archive.sqlite") };

      expect(sessionArchiveSyncWatchRoots([{ agent: "opencode", root: openCodeRoot }])).toEqual([
        { agent: "opencode", root: storageRoot, recursive: true, sourceRoot: openCodeRoot },
      ]);

      const watcher = startSessionArchiveSyncWatcher({
        workspace,
        paths,
        sourceRoots: [{ agent: "opencode", root: openCodeRoot }],
        debounceMs: 25,
      });
      try {
        const sourcePath = join(sessionRoot, "nested-session.json");
        await writeFile(sourcePath, JSON.stringify({
          id: "nested-session",
          messages: [
            { role: "user", content: "Nested watcher sync" },
            { role: "assistant", content: "ok" },
          ],
        }));
        await watcher.syncNow("incremental", [sourcePath]);
        await waitFor(async () => {
          const store = await openSessionArchiveStore({ dbPath: paths.dbPath });
          try {
            return store.getSession("opencode:nested-session")?.first_message === "Nested watcher sync";
          } finally {
            store.close();
          }
        });
      } finally {
        watcher.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 10_000);

  test("watcher debounces source changes and syncs into runtime-state archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-watch-sync-"));
    try {
      const workspace = createWorkspace(root);
      const sourceRoot = join(root, "sources");
      await mkdir(sourceRoot, { recursive: true });
      const paths = { root: join(root, "userData", "runtime-state", "session-archive", "workspaces", workspace.id), dbPath: join(root, "archive.sqlite") };
      const watcher = startSessionArchiveSyncWatcher({
        workspace,
        paths,
        sourceRoots: [{ agent: "codex", root: sourceRoot }],
        debounceMs: 25,
      });
      try {
        await writeFile(join(sourceRoot, "rollout-2026-06-11T12-44-06-watch-1.jsonl"), codexSession("watch-1", "Watcher sync"));
        await waitFor(async () => {
          const store = await openSessionArchiveStore({ dbPath: paths.dbPath });
          try {
            return store.search({ query: "Watcher" }).count === 1;
          } finally {
            store.close();
          }
        });
      } finally {
        watcher.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 10_000);

  test("default sync loads all sessions while explicit limit keeps latest sessions across roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-sync-late-roots-"));
    try {
      const workspace = createWorkspace(root);
      const codexRoot = join(root, "codex");
      const hermesRoot = join(root, "hermes");
      const openClawRoot = join(root, "openclaw");
      const openClawSessions = join(openClawRoot, "main", "sessions");
      await mkdir(codexRoot, { recursive: true });
      await mkdir(hermesRoot, { recursive: true });
      await mkdir(openClawSessions, { recursive: true });
      for (let index = 0; index < 501; index += 1) {
        const path = join(codexRoot, `rollout-2026-06-11T12-44-06-codex-${index}.jsonl`);
        await writeFile(path, codexSession(`codex-${index}`, `Codex ${index}`));
        await touch(path, 1_700_000_000 + index);
      }
      const hermesPath = join(hermesRoot, "20260403_153620_5a3e2ff1.jsonl");
      const openClawPath = join(openClawSessions, "openclaw-late.jsonl");
      await writeFile(hermesPath, hermesSession("Hermes recent root"));
      await writeFile(openClawPath, openClawSession("OpenClaw recent root"));
      await touch(hermesPath, 1_800_000_000);
      await touch(openClawPath, 1_800_000_001);
      const paths = { root: join(root, "userData", "runtime-state", "session-archive", "workspaces", workspace.id), dbPath: join(root, "archive.sqlite") };

      const result = await syncSessionArchive({
        workspace,
        paths,
        sourceRoots: [
          { agent: "codex", root: codexRoot },
          { agent: "hermes", root: hermesRoot },
          { agent: "openclaw", root: openClawRoot },
        ],
      });

      expect(result).toMatchObject({ failed: 0, total_sessions: 503, discovered_sessions: 503 });
      expect(result.recent_limit).toBeUndefined();
      expect(result.omitted_sessions).toBeUndefined();
      const store = await openSessionArchiveStore({ dbPath: paths.dbPath });
      try {
        const all = store.listSessions({ limit: 1000 }).sessions;
        expect(all).toHaveLength(503);
        expect(all.some((session) => session.agent === "hermes" && session.first_message === "Hermes recent root")).toBe(true);
        expect(all.some((session) => session.agent === "openclaw" && session.first_message === "OpenClaw recent root")).toBe(true);
        expect(all.some((session) => session.id === "codex:codex-0")).toBe(true);
      } finally {
        store.close();
      }

      for (let index = 501; index < 560; index += 1) {
        const path = join(codexRoot, `rollout-2026-06-11T12-44-06-codex-${index}.jsonl`);
        await writeFile(path, codexSession(`codex-${index}`, `Codex newer ${index}`));
        await touch(path, 1_900_000_000 + index);
      }
      const second = await syncSessionArchive({
        workspace,
        paths,
        limit: 100,
        sourceRoots: [
          { agent: "codex", root: codexRoot },
          { agent: "hermes", root: hermesRoot },
          { agent: "openclaw", root: openClawRoot },
        ],
      });
      expect(second).toMatchObject({ failed: 0, total_sessions: 100, discovered_sessions: 562, recent_limit: 100, omitted_sessions: 462 });
      const afterLimitedSync = await openSessionArchiveStore({ dbPath: paths.dbPath });
      try {
        const page = afterLimitedSync.listSessions({ limit: 1000 });
        expect(page.total).toBeGreaterThan(100);
        expect(page.sessions.some((session) => session.id === "codex:codex-0")).toBe(true);
      } finally {
        afterLimitedSync.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("incremental sync repairs stale Codex titles from session_index", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-title-repair-"));
    try {
      const workspace = createWorkspace(root);
      const codexRoot = join(root, "codex");
      const sessionDir = join(codexRoot, "archived_sessions");
      await mkdir(sessionDir, { recursive: true });
      const sourcePath = join(sessionDir, "rollout-2026-06-11T12-44-06-title-repair.jsonl");
      const sourceContent = [
        JSON.stringify({ type: "session_meta", timestamp: "2024-01-01T10:00:00Z", payload: { id: "title-repair", cwd: "/tmp/project" } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:01Z", payload: { role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions\n\n<INSTRUCTIONS>\nproject rules\n</INSTRUCTIONS>" }] } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:02Z", payload: { role: "user", content: [{ type: "input_text", text: "修复归档标题" }] } }),
      ].join("\n");
      await writeFile(sourcePath, sourceContent);
      await writeFile(join(codexRoot, "session_index.jsonl"), JSON.stringify({ id: "title-repair", thread_name: "归档标题修复" }));
      const paths = { root: join(root, "userData", "runtime-state", "session-archive", "workspaces", workspace.id), dbPath: join(root, "archive.sqlite") };

      const first = await syncSessionArchive({
        workspace,
        paths,
        sourceRoots: [{ agent: "codex", root: codexRoot }],
      });
      expect(first).toMatchObject({ synced: 1, skipped: 0, failed: 0 });

      const store = await openSessionArchiveStore({ dbPath: paths.dbPath });
      try {
        const stale = store.getSession("codex:title-repair");
        expect(stale).not.toBeNull();
        if (!stale) throw new Error("expected title-repair session");
        store.upsertSession({
          ...stale,
          display_name: null,
          first_message: "# AGENTS.md instructions\n\n<INSTRUCTIONS>\nproject rules\n</INSTRUCTIONS>",
        });
      } finally {
        store.close();
      }

      const second = await syncSessionArchive({
        workspace,
        paths,
        sourceRoots: [{ agent: "codex", root: codexRoot }],
      });
      expect(second).toMatchObject({ synced: 1, skipped: 0, failed: 0 });

      const repaired = await openSessionArchiveStore({ dbPath: paths.dbPath });
      try {
        expect(repaired.getSession("codex:title-repair")).toMatchObject({
          display_name: "归档标题修复",
          first_message: "修复归档标题",
        });
      } finally {
        repaired.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createWorkspace(root: string): WorkspaceInfo {
  return {
    id: "workspace-sync",
    name: "Workspace Sync",
    path: join(root, "repo"),
    preset: "default",
    workspaceType: "local",
  };
}

async function touch(path: string, epochSeconds: number) {
  const date = new Date(epochSeconds * 1000);
  await utimes(path, date, date);
}

function codexSession(id: string, prompt: string): string {
  return [
    JSON.stringify({ type: "session_meta", timestamp: "2024-01-01T10:00:00Z", payload: { id, cwd: "/tmp/project" } }),
    JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:01Z", payload: { role: "user", content: [{ type: "input_text", text: prompt }] } }),
    JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:02Z", payload: { role: "assistant", content: [{ type: "output_text", text: "Done" }] } }),
  ].join("\n");
}

function hermesSession(prompt: string): string {
  return [
    JSON.stringify({ role: "user", content: prompt, timestamp: "2024-01-01T10:00:00Z" }),
    JSON.stringify({ role: "assistant", content: "Hermes reply", timestamp: "2024-01-01T10:00:01Z" }),
  ].join("\n");
}

function openClawSession(prompt: string): string {
  return [
    JSON.stringify({ type: "session", id: "openclaw-late", timestamp: "2024-01-01T10:00:00Z", cwd: "/tmp/openclaw" }),
    JSON.stringify({ type: "message", message: { role: "user", content: prompt, timestamp: "2024-01-01T10:00:01Z" } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: "OpenClaw reply", timestamp: "2024-01-01T10:00:02Z" } }),
  ].join("\n");
}

async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for session-archive watcher sync");
}
