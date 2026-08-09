import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SessionArchiveSyncProgress, SessionArchiveSyncStats } from "@onmyagent/types/session-archive";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import {
  createSessionArchiveSyncWorkerRunner,
  type SessionArchiveSyncWorkerInput,
} from "../src/services/session-archive-sync-worker-runner.js";

class FakeWorker {
  private readonly messageListeners = new Set<(message: { type: string; progress?: SessionArchiveSyncProgress; stats?: SessionArchiveSyncStats; message?: string }) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly exitListeners = new Set<(code: number) => void>();
  terminated = 0;

  onMessage(listener: (message: { type: string; progress?: SessionArchiveSyncProgress; stats?: SessionArchiveSyncStats; message?: string }) => void) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: (error: Error) => void) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onExit(listener: (code: number) => void) {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  start() {}

  terminate(): Promise<void> {
    this.terminated += 1;
    return Promise.resolve();
  }

  message(message: { type: string; progress?: SessionArchiveSyncProgress; stats?: SessionArchiveSyncStats; message?: string }) {
    for (const listener of this.messageListeners) listener(message);
  }

  exit(code: number) {
    for (const listener of this.exitListeners) listener(code);
  }
}

const workspace: WorkspaceInfo = { id: "worker", name: "Worker", path: "/tmp/worker", preset: "starter", workspaceType: "local" };
const input: SessionArchiveSyncWorkerInput = {
  workspace,
  paths: { root: "/tmp/archive", dbPath: "/tmp/archive/archive.sqlite" },
  sourceRoots: [],
};

describe("session archive sync worker runner", () => {
  test("includes the worker entrypoint in standalone binary builds", () => {
    const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const crossBuildScript = readFileSync(new URL("../script/build.ts", import.meta.url), "utf8");
    expect(packageJson).toContain("src/cli.ts src/services/session-archive-sync-worker.ts --outfile");
    expect(crossBuildScript).toContain("const workerEntrypoint = resolve(\"src\", \"services\", \"session-archive-sync-worker.ts\")");
    expect(crossBuildScript).toContain("entrypoint, workerEntrypoint, \"--compile\"");
  });

  test("single-flights callers and forwards progress to each listener", async () => {
    const workers: FakeWorker[] = [];
    const runner = createSessionArchiveSyncWorkerRunner({
      spawnWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const firstProgress: string[] = [];
    const secondProgress: string[] = [];
    const first = runner.run(input, (progress) => firstProgress.push(progress.phase));
    const second = runner.run(input, (progress) => secondProgress.push(progress.phase));
    expect(workers).toHaveLength(1);
    workers[0]?.message({ type: "progress", progress: { phase: "discover", projects_total: 1, projects_done: 0, sessions_total: 0, sessions_done: 0, messages_indexed: 0 } });
    workers[0]?.message({ type: "result", stats: emptyStats() });

    await expect(first).resolves.toEqual(emptyStats());
    await expect(second).resolves.toEqual(emptyStats());
    expect(firstProgress).toEqual(["discover"]);
    expect(secondProgress).toEqual(["discover"]);
    expect(workers[0]?.terminated).toBe(1);
    expect(runner.size()).toBe(0);
  });

  test("settles and terminates when a worker exits without a result", async () => {
    let worker: FakeWorker | undefined;
    const runner = createSessionArchiveSyncWorkerRunner({
      spawnWorker: () => {
        worker = new FakeWorker();
        return worker;
      },
    });
    const promise = runner.run(input);
    worker?.exit(1);
    await expect(promise).rejects.toThrow("exited with code 1");
    expect(worker?.terminated).toBe(1);
    expect(runner.size()).toBe(0);
  });

  test("removes a disposed database immediately so a replacement run can start", async () => {
    const workers: FakeWorker[] = [];
    const runner = createSessionArchiveSyncWorkerRunner({
      spawnWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const first = runner.run(input);
    await runner.dispose(input.paths.dbPath);
    expect(runner.size()).toBe(0);
    const second = runner.run(input);
    expect(workers).toHaveLength(2);
    workers[1]?.message({ type: "result", stats: emptyStats() });
    await expect(first).rejects.toThrow("disposed");
    await expect(second).resolves.toEqual(emptyStats());
  });

  test("rejects and terminates every worker when the runtime is disposed", async () => {
    const workers: FakeWorker[] = [];
    const runner = createSessionArchiveSyncWorkerRunner({
      spawnWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
    const secondInput = {
      ...input,
      paths: { root: "/tmp/archive-2", dbPath: "/tmp/archive-2/archive.sqlite" },
    };
    const first = runner.run(input);
    const second = runner.run(secondInput);
    const firstOutcome = first.catch((error: unknown) => error);
    const secondOutcome = second.catch((error: unknown) => error);

    await runner.disposeAll();

    expect(await firstOutcome).toMatchObject({ message: "Session archive sync worker disposed" });
    expect(await secondOutcome).toMatchObject({ message: "Session archive sync worker disposed" });
    expect(workers.map((worker) => worker.terminated)).toEqual([1, 1]);
    expect(runner.size()).toBe(0);
  });
});

function emptyStats(): SessionArchiveSyncStats {
  return { total_sessions: 0, discovered_sessions: 0, synced: 0, skipped: 0, failed: 0, warnings: [], aborted: false };
}
