import { parentPort } from "node:worker_threads";
import type { SessionArchiveSyncProgress } from "@onmyagent/types/session-archive";
import { syncSessionArchiveInProcess } from "./session-archive-sync.js";
import type { SessionArchiveSyncWorkerInput } from "./session-archive-sync-worker-runner.js";

type WorkerOutput =
  | { type: "progress"; progress: SessionArchiveSyncProgress }
  | { type: "result"; stats: Awaited<ReturnType<typeof syncSessionArchiveInProcess>> }
  | { type: "error"; message: string; stack?: string };

declare const self: {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<SessionArchiveSyncWorkerInput>) => void,
    options: { once: boolean },
  ): void;
  postMessage(message: WorkerOutput): void;
};

const post = (message: WorkerOutput) => {
  if (parentPort) parentPort.postMessage(message);
  else self.postMessage(message);
};

const run = (input: SessionArchiveSyncWorkerInput) => {
  void syncSessionArchiveInProcess({
    ...input,
    onProgress: (progress: SessionArchiveSyncProgress) => {
      post({ type: "progress", progress });
    },
  })
    .then((stats) => post({ type: "result", stats }))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      post({ type: "error", message, ...(stack ? { stack } : {}) });
    });
};

if (parentPort) {
  parentPort.once("message", run);
} else {
  self.addEventListener("message", (event) => run(event.data), { once: true });
}
