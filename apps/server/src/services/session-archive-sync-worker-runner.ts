import { Worker as NodeWorker } from "node:worker_threads";
import type {
  SessionArchiveSyncProgress,
  SessionArchiveSyncStats,
} from "@onmyagent/types/session-archive";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import type {
  SessionArchiveRuntimePaths,
  SessionArchiveSourceRoot,
  SessionArchiveSyncMode,
} from "./session-archive-sync-types.js";

export type SessionArchiveSyncWorkerInput = {
  workspace: WorkspaceInfo;
  paths: SessionArchiveRuntimePaths;
  sourceRoots: SessionArchiveSourceRoot[];
  limit?: number;
  mode?: SessionArchiveSyncMode;
  changedPaths?: string[];
};

type WorkerMessage =
  | { type: "progress"; progress: SessionArchiveSyncProgress }
  | { type: "result"; stats: SessionArchiveSyncStats }
  | { type: "error"; message: string; stack?: string };

type ArchiveWorker = {
  onMessage(listener: (message: WorkerMessage) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  onExit(listener: (code: number) => void): () => void;
  start(input: SessionArchiveSyncWorkerInput): void;
  terminate(): Promise<void>;
};

type SpawnWorker = () => ArchiveWorker;

type RunningWorker = {
  promise: Promise<SessionArchiveSyncStats>;
  terminate: () => Promise<void>;
};

/** One worker per archive database at a time; callers join the same run. */
export function createSessionArchiveSyncWorkerRunner(options: {
  spawnWorker?: SpawnWorker;
} = {}) {
  const spawnWorker = options.spawnWorker ?? spawnSessionArchiveWorker;
  const running = new Map<string, RunningWorker & {
    listeners: Set<(progress: SessionArchiveSyncProgress) => void>;
  }>();

  return {
    run(input: SessionArchiveSyncWorkerInput, onProgress?: (progress: SessionArchiveSyncProgress) => void): Promise<SessionArchiveSyncStats> {
      const key = input.paths.dbPath;
      const existing = running.get(key);
      if (existing) {
        if (onProgress) existing.listeners.add(onProgress);
        return existing.promise;
      }
      const listeners = new Set<(progress: SessionArchiveSyncProgress) => void>();
      if (onProgress) listeners.add(onProgress);
      const workerRun = runWorker(input, spawnWorker, listeners);
      const promise = workerRun.promise.finally(() => {
        if (running.get(key)?.promise === promise) running.delete(key);
      });
      running.set(key, { promise, listeners, terminate: workerRun.terminate });
      return promise;
    },
    size(): number {
      return running.size;
    },
    async dispose(dbPath: string): Promise<void> {
      const entry = running.get(dbPath);
      if (!entry) return;
      running.delete(dbPath);
      await entry.terminate();
    },
    async disposeAll(): Promise<void> {
      const entries = [...running.values()];
      running.clear();
      await Promise.all(entries.map((entry) => entry.terminate()));
    },
  };
}

export const defaultSessionArchiveSyncWorkerRunner = createSessionArchiveSyncWorkerRunner();

function spawnSessionArchiveWorker(): ArchiveWorker {
  // Bun standalone executables address bundled worker entrypoints by their
  // source path relative to the CLI entrypoint. Node/Electron production
  // builds execute the emitted sibling .js file.
  if (import.meta.url.includes("/$bunfs/")) {
    return bunWorkerAdapter(new Worker(new URL("./services/session-archive-sync-worker.js", import.meta.url)));
  }
  return nodeWorkerAdapter(new NodeWorker(new URL("./session-archive-sync-worker.js", import.meta.url)));
}

function nodeWorkerAdapter(worker: NodeWorker): ArchiveWorker {
  return {
    onMessage(listener) {
      worker.on("message", listener);
      return () => worker.off("message", listener);
    },
    onError(listener) {
      worker.on("error", listener);
      return () => worker.off("error", listener);
    },
    onExit(listener) {
      worker.on("exit", listener);
      return () => worker.off("exit", listener);
    },
    start(input) {
      worker.postMessage(input);
    },
    async terminate() {
      await worker.terminate();
    },
  };
}

function bunWorkerAdapter(worker: Worker): ArchiveWorker {
  return {
    onMessage(listener) {
      const handler = (event: MessageEvent<WorkerMessage>) => listener(event.data);
      worker.addEventListener("message", handler);
      return () => worker.removeEventListener("message", handler);
    },
    onError(listener) {
      const handler = (event: ErrorEvent) => listener(new Error(event.message));
      worker.addEventListener("error", handler);
      return () => worker.removeEventListener("error", handler);
    },
    onExit(listener) {
      const handler = (event: Event) => {
        const code = "code" in event && typeof event.code === "number" ? event.code : 0;
        listener(code);
      };
      worker.addEventListener("close", handler);
      return () => worker.removeEventListener("close", handler);
    },
    start(input) {
      worker.postMessage(input);
    },
    terminate() {
      worker.terminate();
      return Promise.resolve();
    },
  };
}

function runWorker(
  input: SessionArchiveSyncWorkerInput,
  spawnWorker: SpawnWorker,
  listeners: Set<(progress: SessionArchiveSyncProgress) => void>,
): RunningWorker {
  let terminate = (): Promise<void> => Promise.resolve();
  const promise = new Promise<SessionArchiveSyncStats>((resolve, reject) => {
    let worker: ArchiveWorker;
    try {
      worker = spawnWorker();
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    let removeMessage: () => void = () => {};
    let removeError: () => void = () => {};
    let removeExit: () => void = () => {};
    let cleanupPromise: Promise<void> | null = null;
    const cleanup = () => {
      if (cleanupPromise) return cleanupPromise;
      removeMessage();
      removeError();
      removeExit();
      cleanupPromise = worker.terminate().catch(() => undefined);
      return cleanupPromise;
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      void cleanup();
      callback();
    };
    const onMessage = (message: WorkerMessage) => {
      if (message.type === "progress") {
        for (const listener of listeners) {
          try {
            listener(message.progress);
          } catch {
            // Progress observers must not prevent the worker result settling.
          }
        }
        return;
      }
      if (message.type === "result") {
        settle(() => resolve(message.stats));
        return;
      }
      settle(() => reject(workerError(message.message, message.stack)));
    };
    const onError = (error: Error) => settle(() => reject(error));
    const onExit = (code: number) => {
      if (code !== 0) settle(() => reject(new Error(`Session archive sync worker exited with code ${code}`)));
      else settle(() => reject(new Error("Session archive sync worker exited without a result")));
    };
    terminate = () => {
      settle(() => reject(new Error("Session archive sync worker disposed")));
      return cleanup();
    };
    removeMessage = worker.onMessage(onMessage);
    removeError = worker.onError(onError);
    removeExit = worker.onExit(onExit);
    try {
      worker.start(input);
    } catch (error) {
      settle(() => reject(error));
    }
  });
  return { promise, terminate: () => terminate() };
}

function workerError(message: string, stack?: string): Error {
  const error = new Error(message);
  if (stack) error.stack = stack;
  return error;
}
