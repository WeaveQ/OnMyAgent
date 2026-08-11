/**
 * Expert cold-start path: global serial queue (B) + draft prewarm (A).
 *
 * First expert send pays isolate dir + session.create (OpenCode cold project).
 * Prewarm runs that work while the user types; concurrent experts share one
 * queue so two cold boots cannot thrash the single OpenCode process.
 */

export type ExpertColdPathRequest = {
  workspaceId: string;
  agentId: string;
  agentName: string;
  skillNames?: readonly string[];
};

export type ExpertColdPathResult = {
  directory: string;
  sessionId: string;
  workspaceId: string;
  agentId: string;
};

export type ExpertColdPathRunner = {
  createIsolatedDirectory: () => Promise<{ directory: string } | null>;
  createSession: (directory: string) => Promise<{ id: string }>;
};

type SlotPhase = "running" | "ready" | "failed";

type ColdSlot = {
  key: string;
  fingerprint: string;
  phase: SlotPhase;
  promise: Promise<ExpertColdPathResult>;
  result: ExpertColdPathResult | null;
  consumed: boolean;
  error: unknown;
};

let queueTail: Promise<unknown> = Promise.resolve();
const slots = new Map<string, ColdSlot>();

/** Serialize expert isolate + session.create across the whole app. */
export function enqueueExpertColdPath<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(task, task);
  queueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function buildExpertColdPrewarmKey(
  workspaceId: string,
  agentId: string,
): string {
  return `${workspaceId.trim()}\0${agentId.trim() || "_"}`;
}

export function skillNamesFingerprint(
  skillNames: readonly string[] | undefined,
): string {
  if (!skillNames?.length) return "";
  return [...skillNames]
    .map((name) => String(name ?? "").trim())
    .filter(Boolean)
    .sort()
    .join("\0");
}

function requestKey(request: ExpertColdPathRequest): string {
  return buildExpertColdPrewarmKey(request.workspaceId, request.agentId);
}

function requestFingerprint(request: ExpertColdPathRequest): string {
  return skillNamesFingerprint(request.skillNames);
}

async function runColdCreate(
  request: ExpertColdPathRequest,
  runner: ExpertColdPathRunner,
): Promise<ExpertColdPathResult> {
  const isolated = await runner.createIsolatedDirectory();
  const directory = isolated?.directory?.trim() ?? "";
  if (!directory) {
    throw new Error("Unable to allocate an external expert session directory");
  }
  const created = await runner.createSession(directory);
  const sessionId = created?.id?.trim() ?? "";
  if (!sessionId) {
    throw new Error("OpenCode session.create returned no session id");
  }
  return {
    directory,
    sessionId,
    workspaceId: request.workspaceId.trim(),
    agentId: request.agentId.trim(),
  };
}

/**
 * Get an in-flight/ready cold session for this agent, or start isolate+create
 * on the global queue. Does not mark the result consumed (prewarm leaves it).
 */
export function getOrStartExpertColdSession(
  request: ExpertColdPathRequest,
  runner: ExpertColdPathRunner,
): Promise<ExpertColdPathResult> {
  const key = requestKey(request);
  const fingerprint = requestFingerprint(request);
  const existing = slots.get(key);
  if (
    existing &&
    existing.fingerprint === fingerprint &&
    !existing.consumed &&
    (existing.phase === "running" || existing.phase === "ready")
  ) {
    return existing.promise;
  }

  const promise = enqueueExpertColdPath(() => runColdCreate(request, runner));
  const slot: ColdSlot = {
    key,
    fingerprint,
    phase: "running",
    promise,
    result: null,
    consumed: false,
    error: null,
  };
  slots.set(key, slot);

  void promise.then(
    (result) => {
      const current = slots.get(key);
      if (current !== slot) return;
      current.phase = "ready";
      current.result = result;
    },
    (error) => {
      const current = slots.get(key);
      if (current !== slot) return;
      current.phase = "failed";
      current.error = error;
      current.consumed = true;
      slots.delete(key);
    },
  );

  return promise;
}

/** A: Fire-and-forget prewarm while the user is on an expert draft. */
export function startExpertColdPrewarm(
  request: ExpertColdPathRequest,
  runner: ExpertColdPathRunner,
): void {
  if (!request.workspaceId.trim()) return;
  void getOrStartExpertColdSession(request, runner).catch((error) => {
    // Send path will create on demand; log so prewarm misses are visible.
    console.warn("[expert-cold-path] prewarm failed", {
      workspaceId: request.workspaceId,
      agentId: request.agentId,
      error,
    });
  });
}

/**
 * A+B: Prefer a prewarmed (or in-flight) cold session; otherwise create one.
 * Exclusive claim — a second concurrent claim starts a fresh create.
 */
export async function claimOrCreateExpertColdSession(
  request: ExpertColdPathRequest,
  runner: ExpertColdPathRunner,
): Promise<ExpertColdPathResult> {
  const key = requestKey(request);
  const fingerprint = requestFingerprint(request);

  const tryConsumeReady = (): ExpertColdPathResult | null => {
    const slot = slots.get(key);
    if (
      !slot ||
      slot.fingerprint !== fingerprint ||
      slot.consumed ||
      slot.phase !== "ready" ||
      !slot.result
    ) {
      return null;
    }
    slot.consumed = true;
    slots.delete(key);
    return slot.result;
  };

  const ready = tryConsumeReady();
  if (ready) return ready;

  const existing = slots.get(key);
  if (
    existing &&
    existing.fingerprint === fingerprint &&
    !existing.consumed &&
    existing.phase === "running"
  ) {
    try {
      await existing.promise;
    } catch {
      // fall through to fresh create
    }
    const after = tryConsumeReady();
    if (after) return after;
  }

  // Fresh create: do not leave a reusable prewarm slot (already claimed for send).
  return enqueueExpertColdPath(async () => {
    // Another waiter may have finished a slot while we queued.
    const raced = tryConsumeReady();
    if (raced) return raced;
    return runColdCreate(request, runner);
  });
}

/** Drop prewarm slots (e.g. tests). Optional filter by workspace/agent. */
export function invalidateExpertColdPrewarm(input?: {
  workspaceId?: string;
  agentId?: string;
}): void {
  const workspaceId = input?.workspaceId?.trim() ?? "";
  const agentId = input?.agentId?.trim() ?? "";
  if (!workspaceId && !agentId) {
    slots.clear();
    return;
  }
  for (const [key, slot] of [...slots.entries()]) {
    if (workspaceId && slot.result?.workspaceId === workspaceId) {
      slots.delete(key);
      continue;
    }
    if (workspaceId && key.startsWith(`${workspaceId}\0`)) {
      slots.delete(key);
      continue;
    }
    if (agentId && (slot.result?.agentId === agentId || key.endsWith(`\0${agentId}`))) {
      slots.delete(key);
    }
  }
}

/** Test helper: reset queue + slots. */
export function resetExpertColdPathForTests(): void {
  queueTail = Promise.resolve();
  slots.clear();
}

/** Test helper: inspect prewarm registry. */
export function getExpertColdPrewarmDebugSnapshot(): Array<{
  key: string;
  phase: SlotPhase;
  fingerprint: string;
  consumed: boolean;
  sessionId: string | null;
}> {
  return [...slots.values()].map((slot) => ({
    key: slot.key,
    phase: slot.phase,
    fingerprint: slot.fingerprint,
    consumed: slot.consumed,
    sessionId: slot.result?.sessionId ?? null,
  }));
}
