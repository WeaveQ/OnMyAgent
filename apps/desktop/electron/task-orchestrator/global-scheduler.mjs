// @ts-check

/**
 * A process-local admission controller for Task Center attempts.
 *
 * The scheduler deliberately owns no persistence and never starts a provider
 * process. Callers persist an attempt before enqueueing it, await the returned
 * admission promise, spawn their provider, and release the lease exactly once
 * when that attempt leaves the active set.
 */

const DEFAULT_MAX_ACTIVE_ATTEMPTS = 4;
const DEFAULT_MAX_PRIORITY_BURST = 3;
const PRIORITY_LABELS = new Map([
  ["low", -100],
  ["normal", 0],
  ["default", 0],
  ["high", 100],
  ["urgent", 200],
]);

/** @typedef {"queued" | "active" | "cancelled" | "released" | "rejected"} AdmissionState */

/**
 * @typedef {Object} AdmissionRequest
 * @property {string} runId
 * @property {string} attemptId
 * @property {string} kind
 * @property {number} priority
 * @property {unknown} [metadata]
 * @property {number} [sequence]
 * @property {number} [enqueuedAt]
 */

/**
 * @typedef {AdmissionRequest & {
 *   key: string,
 *   sequence: number,
 *   enqueuedAt: number,
 *   worker: boolean,
 *   state: AdmissionState,
 *   lease: AdmissionLease | null,
 *   resolve: (lease: AdmissionLease) => void,
 *   reject: (error: Error) => void,
 *   ticket: AdmissionTicket,
 * }} AdmissionEntry
 */

/**
 * @typedef {Object} AdmissionLease
 * @property {string} key
 * @property {string} runId
 * @property {string} attemptId
 * @property {string} kind
 * @property {number} priority
 * @property {number} admittedAt
 * @property {boolean} released
 * @property {() => boolean} release
 * @property {() => boolean} done
 */

/**
 * A promise-like admission ticket. Awaiting the ticket resolves to an
 * AdmissionLease. The extra methods make queued cancellation convenient while
 * retaining the familiar `await scheduler.enqueue(...)` API.
 *
 * @typedef {Promise<AdmissionLease> & {
 *   key: string,
 *   runId: string,
 *   attemptId: string,
 *   kind: string,
 *   priority: number,
 *   status: AdmissionState,
 *   state: AdmissionState,
 *   lease: AdmissionLease | null,
 *   promise: AdmissionTicket,
 *   cancel: (reason?: string) => boolean,
 *   __entry?: AdmissionEntry,
 * }} AdmissionTicket
 */

/**
 * @typedef {Object} SchedulerSnapshot
 * @property {boolean} closed
 * @property {number} maxActiveAttempts
 * @property {number} reservedWorkerSlots
 * @property {number} active
 * @property {number} activeWorkers
 * @property {number} activeNonWorkers
 * @property {number} queued
 * @property {number | null} oldestQueuedAt
 * @property {number} queueLagMs
 * @property {number} peak
 * @property {number} peakActive
 * @property {number} highPriorityStreak
 * @property {Record<string, {active: number, queued: number, total: number}>} perRun
 * @property {Record<string, number>} activePerRun
 * @property {Record<string, number>} queuedPerRun
 */

/**
 * @typedef {Object} SchedulerOptions
 * @property {number} [maxActiveAttempts]
 * @property {number} [maxGlobalActiveAttempts]
 * @property {number} [maxActive]
 * @property {number} [maxConcurrency]
 * @property {number} [concurrency]
 * @property {number} [maxPriorityBurst]
 * @property {number} [antiStarvationLimit]
 * @property {number} [workerStarvationLimit]
 * @property {number} [reservedWorkerSlots]
 * @property {number} [workerReserve]
 * @property {() => number} [now]
 * @property {{ now?: () => number }} [clock]
 * @property {{
 *   onAdmit?: (event: Record<string, unknown>) => unknown,
 *   onGrant?: (event: Record<string, unknown>) => unknown,
 *   onDispatch?: (event: Record<string, unknown>) => unknown,
 *   onEnqueue?: (event: Record<string, unknown>) => unknown,
 *   onRelease?: (event: Record<string, unknown>) => unknown,
 *   onCancel?: (event: Record<string, unknown>) => unknown,
 *   onClose?: (event: Record<string, unknown>) => unknown,
 *   onChange?: (event: Record<string, unknown>) => unknown,
 *   onHookError?: (event: Record<string, unknown>) => unknown,
 * }} [hooks]
 * @property {(event: Record<string, unknown>) => unknown} [onAdmit]
 * @property {(event: Record<string, unknown>) => unknown} [onGrant]
 * @property {(event: Record<string, unknown>) => unknown} [onDispatch]
 * @property {(event: Record<string, unknown>) => unknown} [onEnqueue]
 * @property {(event: Record<string, unknown>) => unknown} [onRelease]
 * @property {(event: Record<string, unknown>) => unknown} [onCancel]
 * @property {(event: Record<string, unknown>) => unknown} [onClose]
 * @property {(event: Record<string, unknown>) => unknown} [onChange]
 */

/** Error raised when a queued admission is cancelled. */
export class AdmissionCancelledError extends Error {
  /** @param {string} [message] */
  constructor(message = "Task attempt admission was cancelled") {
    super(message);
    this.name = "AdmissionCancelledError";
    /** @type {string} */
    this.code = "SCHEDULER_CANCELLED";
  }
}

/** Error raised when a scheduler is closed before an admission is granted. */
export class SchedulerClosedError extends Error {
  /** @param {string} [message] */
  constructor(message = "Task attempt scheduler is closed") {
    super(message);
    this.name = "SchedulerClosedError";
    /** @type {string} */
    this.code = "SCHEDULER_CLOSED";
  }
}

/** Error raised when an attempt is already queued or active. */
export class AdmissionConflictError extends Error {
  /** @param {string} key */
  constructor(key) {
    super(`Task attempt admission already exists for ${key}`);
    this.name = "AdmissionConflictError";
    /** @type {string} */
    this.code = "SCHEDULER_DUPLICATE";
  }
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
function requiredId(value, name) {
  const id = String(value ?? "").trim();
  if (!id) throw new TypeError(`${name} is required`);
  return id;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeKind(value) {
  const raw = String(value ?? "primary").trim().toLowerCase().replaceAll("_", "-");
  if (!raw) return "primary";
  if (raw === "continuation" || raw === "resume" || raw === "resumed") return "resume";
  if (raw === "followup" || raw === "follow-up" || raw === "worker-followup" || raw === "worker-follow-up") {
    return "worker-follow-up";
  }
  if (raw === "worker") return "worker";
  if (raw === "primary") return "primary";
  return raw;
}

/**
 * @param {string} kind
 * @returns {boolean}
 */
function isWorkerKind(kind) {
  return kind === "worker" || kind.startsWith("worker-") || kind.includes("follow-up");
}

/**
 * @param {unknown} value
 * @param {string} kind
 * @returns {number}
 */
function normalizePriority(value, kind) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "string") {
    const label = value.trim().toLowerCase();
    if (PRIORITY_LABELS.has(label)) return PRIORITY_LABELS.get(label) ?? 0;
    if (label === "primary" || label === "resume") return 100;
    if (label === "worker" || label === "worker-follow-up" || label === "worker-followup") return 0;
  }
  const priority = Number(value);
  if (!Number.isFinite(priority)) {
    throw new TypeError(`priority must be a finite number or a known label for ${kind}`);
  }
  return priority;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {string} name
 * @returns {number}
 */
function positiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new RangeError(`${name} must be a positive integer`);
  return number;
}

/**
 * @param {unknown} target
 * @param {unknown} attemptId
 * @param {unknown} kind
 * @param {unknown} priority
 * @returns {{ runId: string, attemptId: string, kind: string, priority: number, metadata: unknown, sequence?: number, enqueuedAt?: number }}
 */
function requestFromArguments(target, attemptId, kind, priority) {
  const input = target && typeof target === "object" ? /** @type {Record<string, unknown>} */ (target) : {
    runId: target,
    attemptId,
    kind,
    priority,
  };
  const normalizedKind = normalizeKind(input.kind);
  return {
    runId: requiredId(input.runId, "runId"),
    attemptId: requiredId(input.attemptId, "attemptId"),
    kind: normalizedKind,
    priority: normalizePriority(input.priority, normalizedKind),
    metadata: input.metadata,
    sequence: Number.isInteger(Number(input.sequence)) && Number(input.sequence) > 0 ? Number(input.sequence) : undefined,
    enqueuedAt: Number.isFinite(Number(input.enqueuedAt)) ? Number(input.enqueuedAt) : undefined,
  };
}

/** @param {string} runId @param {string} attemptId */
function admissionKey(runId, attemptId) {
  return `${runId}\u0000${attemptId}`;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function timestamp(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : Date.now();
}

/**
 * Create a bounded, fair, process-local global attempt admission scheduler.
 *
 * @param {SchedulerOptions} [options]
 */
export function createGlobalAdmissionScheduler(options = {}) {
  const maxActiveAttempts = positiveInteger(
    options.maxActiveAttempts
      ?? options.maxGlobalActiveAttempts
      ?? options.maxActive
      ?? options.maxConcurrency
      ?? options.concurrency,
    DEFAULT_MAX_ACTIVE_ATTEMPTS,
    "maxActiveAttempts",
  );
  const maxPriorityBurst = positiveInteger(
    options.maxPriorityBurst ?? options.antiStarvationLimit ?? options.workerStarvationLimit,
    DEFAULT_MAX_PRIORITY_BURST,
    "maxPriorityBurst",
  );
  const configuredReservedWorkerSlots = options.reservedWorkerSlots ?? options.workerReserve;
  const reservedWorkerSlots = configuredReservedWorkerSlots === undefined
    ? maxActiveAttempts > 1 ? 1 : 0
    : Number(configuredReservedWorkerSlots);
  if (!Number.isInteger(reservedWorkerSlots) || reservedWorkerSlots < 0 || reservedWorkerSlots >= maxActiveAttempts) {
    throw new RangeError("reservedWorkerSlots must be an integer from 0 to maxActiveAttempts - 1");
  }
  const now = typeof options.now === "function"
    ? options.now
    : typeof options.clock?.now === "function"
      ? options.clock.now
      : () => Date.now();
  const hooks = options.hooks ?? {};

  /** @type {Map<string, AdmissionEntry[]>} */
  const queues = new Map();
  /** @type {Map<string, AdmissionEntry>} */
  const queuedByKey = new Map();
  /** @type {Map<string, AdmissionEntry>} */
  const activeByKey = new Map();
  /** @type {Map<string, {active: number, queued: number}>} */
  const runCounts = new Map();
  /** @type {string[]} */
  const runOrder = [];
  let runCursor = 0;
  let sequence = 0;
  let peak = 0;
  let activeWorkers = 0;
  let activeNonWorkers = 0;
  let highPriorityStreak = 0;
  let closed = false;
  let dispatching = false;
  let dispatchHold = 0;

  /** @returns {number} */
  function currentTime() {
    return timestamp(now());
  }

  /**
   * @param {string} runId
   */
  function ensureRun(runId) {
    if (!queues.has(runId)) {
      queues.set(runId, []);
      runOrder.push(runId);
    }
    if (!runCounts.has(runId)) runCounts.set(runId, { active: 0, queued: 0 });
  }

  /**
   * @param {string} runId
   */
  function pruneRun(runId) {
    const queue = queues.get(runId);
    const counts = runCounts.get(runId);
    if ((queue?.length ?? 0) > 0 || (counts?.active ?? 0) > 0) return;
    queues.delete(runId);
    runCounts.delete(runId);
    const index = runOrder.indexOf(runId);
    if (index < 0) return;
    runOrder.splice(index, 1);
    if (index < runCursor) runCursor -= 1;
    if (runCursor < 0 || runCursor >= runOrder.length) runCursor = 0;
  }

  /** @param {string} runId @param {"active" | "queued"} field @param {number} delta */
  function changeRunCount(runId, field, delta) {
    ensureRun(runId);
    const counts = runCounts.get(runId);
    if (!counts) return;
    counts[field] = Math.max(0, counts[field] + delta);
  }

  /**
   * @param {string} name
   * @param {Record<string, unknown>} event
   */
  function invokeHook(name, event) {
    const optionHooks = /** @type {Record<string, unknown>} */ (options);
    const hookRecord = /** @type {Record<string, unknown>} */ (hooks);
    const candidate = optionHooks[name] ?? hookRecord[name];
    if (typeof candidate !== "function") return;
    try {
      const result = candidate(event);
      if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
        void /** @type {Promise<unknown>} */ (result).catch((error) => invokeHook("onHookError", { name, event, error }));
      }
    } catch (error) {
      invokeHook("onHookError", { name, event, error });
    }
  }

  /** @returns {SchedulerSnapshot} */
  function snapshot() {
    /** @type {Record<string, {active: number, queued: number, total: number}>} */
    const perRun = {};
    /** @type {Record<string, number>} */
    const activePerRun = {};
    /** @type {Record<string, number>} */
    const queuedPerRun = {};
    for (const [runId, counts] of runCounts) {
      const item = { active: counts.active, queued: counts.queued, total: counts.active + counts.queued };
      perRun[runId] = item;
      activePerRun[runId] = item.active;
      queuedPerRun[runId] = item.queued;
    }
    const active = activeByKey.size;
    const queued = queuedByKey.size;
    let oldestQueuedAt = null;
    for (const entry of queuedByKey.values()) {
      if (oldestQueuedAt === null || entry.enqueuedAt < oldestQueuedAt) oldestQueuedAt = entry.enqueuedAt;
    }
    return {
      closed,
      maxActiveAttempts,
      reservedWorkerSlots,
      active,
      activeWorkers,
      activeNonWorkers,
      queued,
      oldestQueuedAt,
      queueLagMs: oldestQueuedAt === null ? 0 : Math.max(0, currentTime() - oldestQueuedAt),
      peak,
      peakActive: peak,
      highPriorityStreak,
      perRun,
      activePerRun,
      queuedPerRun,
    };
  }

  /**
   * @param {AdmissionEntry} entry
   * @returns {Record<string, unknown>}
   */
  function publicRequest(entry) {
    return {
      key: entry.key,
      runId: entry.runId,
      attemptId: entry.attemptId,
      kind: entry.kind,
      priority: entry.priority,
      metadata: entry.metadata,
      sequence: entry.sequence,
      enqueuedAt: entry.enqueuedAt,
    };
  }

  /**
   * @param {AdmissionEntry} entry
   * @returns {AdmissionLease}
   */
  function createLease(entry) {
    let released = false;
    const admittedAt = currentTime();
    /** @type {AdmissionLease} */
    const lease = {
      key: entry.key,
      runId: entry.runId,
      attemptId: entry.attemptId,
      kind: entry.kind,
      priority: entry.priority,
      admittedAt,
      get released() {
        return released;
      },
      release() {
        if (released) return false;
        released = true;
        return releaseEntry(entry);
      },
      done() {
        return lease.release();
      },
    };
    return lease;
  }

  /** @param {AdmissionEntry} entry */
  function removeFromQueue(entry) {
    const queue = queues.get(entry.runId);
    if (!queue) return;
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
  }

  /**
   * @param {AdmissionEntry} entry
   * @param {string} reason
   * @returns {boolean}
   */
  function cancelEntry(entry, reason = "Task attempt admission was cancelled") {
    if (entry.state !== "queued") return false;
    entry.state = "cancelled";
    queuedByKey.delete(entry.key);
    removeFromQueue(entry);
    changeRunCount(entry.runId, "queued", -1);
    pruneRun(entry.runId);
    entry.reject(new AdmissionCancelledError(reason));
    const event = {
      ...publicRequest(entry),
      reason,
      snapshot: snapshot(),
    };
    invokeHook("onCancel", event);
    invokeHook("onChange", { type: "cancel", ...event });
    dispatch();
    return true;
  }

  /**
   * @param {AdmissionEntry} entry
   * @returns {boolean}
   */
  function releaseEntry(entry) {
    if (entry.state !== "active") return false;
    entry.state = "released";
    activeByKey.delete(entry.key);
    if (entry.worker) activeWorkers = Math.max(0, activeWorkers - 1);
    else activeNonWorkers = Math.max(0, activeNonWorkers - 1);
    changeRunCount(entry.runId, "active", -1);
    pruneRun(entry.runId);
    const event = {
      ...publicRequest(entry),
      lease: entry.lease,
      snapshot: snapshot(),
    };
    invokeHook("onRelease", event);
    invokeHook("onChange", { type: "release", ...event });
    dispatch();
    return true;
  }

  /**
   * A reserved worker slot is unavailable to primary/resume admissions. Worker
   * attempts can use every global slot, including capacity that is normally
   * reserved for them.
   *
   * @param {AdmissionEntry} entry
   * @returns {boolean}
   */
  function canAdmitEntry(entry) {
    if (activeByKey.size >= maxActiveAttempts) return false;
    if (entry.worker) return true;
    return activeNonWorkers < maxActiveAttempts - reservedWorkerSlots;
  }

  /**
   * Pick the best entry in one priority category. Category selection is
   * separate from priority selection so a waiting worker is guaranteed a slot
   * after a bounded number of primary/resume admissions.
   *
   * @param {boolean} worker
   * @returns {AdmissionEntry | null}
   */
  function pickFromCategory(worker) {
    /** @type {AdmissionEntry[]} */
    const candidates = [];
    for (const entry of queuedByKey.values()) {
      if (entry.worker === worker && canAdmitEntry(entry)) candidates.push(entry);
    }
    if (candidates.length === 0 || runOrder.length === 0) return null;
    const bestPriority = Math.max(...candidates.map((entry) => entry.priority));
    const eligible = new Set(candidates.filter((entry) => entry.priority === bestPriority));
    for (let offset = 0; offset < runOrder.length; offset += 1) {
      const index = (runCursor + offset) % runOrder.length;
      const runId = runOrder[index];
      const queue = queues.get(runId) ?? [];
      let selected = null;
      for (const entry of queue) {
        if (!eligible.has(entry)) continue;
        if (!selected || entry.sequence < selected.sequence) selected = entry;
      }
      if (selected) {
        runCursor = runOrder.length > 0 ? (index + 1) % runOrder.length : 0;
        return selected;
      }
    }
    return null;
  }

  /** @returns {AdmissionEntry | null} */
  function pickNext() {
    let hasWorker = false;
    let hasPrimary = false;
    for (const entry of queuedByKey.values()) {
      if (!canAdmitEntry(entry)) continue;
      if (entry.worker) hasWorker = true;
      else hasPrimary = true;
      if (hasWorker && hasPrimary) break;
    }
    if (!hasWorker && !hasPrimary) return null;
    const forceWorker = hasWorker && highPriorityStreak >= maxPriorityBurst;
    const worker = forceWorker || !hasPrimary;
    return pickFromCategory(worker);
  }

  /** @param {AdmissionEntry} entry */
  function admitEntry(entry) {
    entry.state = "active";
    queuedByKey.delete(entry.key);
    removeFromQueue(entry);
    changeRunCount(entry.runId, "queued", -1);
    activeByKey.set(entry.key, entry);
    if (entry.worker) activeWorkers += 1;
    else activeNonWorkers += 1;
    changeRunCount(entry.runId, "active", 1);
    peak = Math.max(peak, activeByKey.size);
    if (entry.worker) highPriorityStreak = 0;
    else {
      let workerWaiting = false;
      for (const queued of queuedByKey.values()) {
        if (queued.worker) {
          workerWaiting = true;
          break;
        }
      }
      highPriorityStreak = workerWaiting ? highPriorityStreak + 1 : 0;
    }
    const lease = createLease(entry);
    entry.lease = lease;
    const event = {
      ...publicRequest(entry),
      lease,
      snapshot: snapshot(),
    };
    invokeHook("onAdmit", event);
    invokeHook("onGrant", event);
    invokeHook("onDispatch", event);
    invokeHook("onChange", { type: "admit", ...event });
    entry.resolve(lease);
  }

  function dispatch() {
    if (dispatching || dispatchHold > 0) return;
    dispatching = true;
    try {
      while (!closed && activeByKey.size < maxActiveAttempts && queuedByKey.size > 0) {
        const entry = pickNext();
        if (!entry) break;
        admitEntry(entry);
      }
    } finally {
      dispatching = false;
    }
  }

  /**
   * @param {AdmissionRequest} request
   * @param {AdmissionState} [state]
   * @param {AdmissionLease | null} [lease]
   * @returns {AdmissionTicket}
   */
  function createTicket(request, state = "queued", lease = null) {
    let resolvePromise = /** @type {(lease: AdmissionLease) => void} */ (() => undefined);
    let rejectPromise = /** @type {(error: Error) => void} */ (() => undefined);
    const promise = /** @type {AdmissionTicket} */ (new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }));
    const key = admissionKey(request.runId, request.attemptId);
    const entry = /** @type {AdmissionEntry} */ ({
      ...request,
      key,
      sequence: 0,
      enqueuedAt: 0,
      worker: isWorkerKind(request.kind),
      state,
      lease,
      resolve: resolvePromise,
      reject: rejectPromise,
      ticket: promise,
    });
    Object.defineProperties(promise, {
      key: { enumerable: true, get: () => key },
      runId: { enumerable: true, get: () => request.runId },
      attemptId: { enumerable: true, get: () => request.attemptId },
      kind: { enumerable: true, get: () => request.kind },
      priority: { enumerable: true, get: () => request.priority },
      status: { enumerable: true, get: () => entry.state },
      state: { enumerable: true, get: () => entry.state },
      lease: { enumerable: true, get: () => entry.lease },
      promise: { enumerable: false, get: () => promise },
      cancel: {
        enumerable: true,
        value: (reason = "Task attempt admission was cancelled") => (entry ? cancelEntry(entry, reason) : false),
      },
    });
    Object.defineProperty(promise, "__entry", { value: entry, enumerable: false });
    return promise;
  }

  /**
   * Queue an attempt for admission. The returned promise resolves to a lease
   * when capacity is available; its `.cancel()` method only cancels a queued
   * request and is a no-op after admission.
   *
   * @param {Record<string, unknown> | string} input
   * @param {unknown} [attemptId]
   * @param {unknown} [kind]
   * @param {unknown} [priority]
   * @returns {AdmissionTicket}
   */
  function enqueue(input, attemptId, kind, priority) {
    const request = requestFromArguments(input, attemptId, kind, priority);
    const key = admissionKey(request.runId, request.attemptId);
    if (closed) {
      return rejectTicket(request, new SchedulerClosedError());
    }
    if (queuedByKey.has(key) || activeByKey.has(key)) {
      const ticket = rejectTicket(request, new AdmissionConflictError(key));
      return ticket;
    }
    const ticket = createTicket(request);
    const entry = /** @type {AdmissionEntry} */ (/** @type {unknown} */ (ticket.__entry));
    // `createTicket` keeps the entry private; retrieving it through the map is
    // avoided by setting it immediately below before any dispatch occurs.
    const sequenceHint = Number(request.sequence);
    entry.sequence = Number.isInteger(sequenceHint) && sequenceHint > 0 ? sequenceHint : sequence + 1;
    sequence = Math.max(sequence, entry.sequence);
    const enqueuedAtHint = Number(request.enqueuedAt);
    entry.enqueuedAt = Number.isFinite(enqueuedAtHint) ? enqueuedAtHint : currentTime();
    ensureRun(entry.runId);
    queues.get(entry.runId)?.push(entry);
    queuedByKey.set(entry.key, entry);
    changeRunCount(entry.runId, "queued", 1);
    const event = { type: "enqueue", ...publicRequest(entry), snapshot: snapshot() };
    invokeHook("onEnqueue", event);
    invokeHook("onChange", event);
    dispatch();
    return ticket;
  }

  /**
   * Build a rejected ticket with the same observable shape as enqueue().
   * @param {AdmissionRequest} request
   * @param {Error} error
   * @returns {AdmissionTicket}
   */
  function rejectTicket(request, error) {
    /** @type {AdmissionTicket} */
    const promise = /** @type {AdmissionTicket} */ (Promise.reject(error));
    promise.catch(() => undefined);
    Object.defineProperties(promise, {
      key: { enumerable: true, value: admissionKey(request.runId, request.attemptId) },
      runId: { enumerable: true, value: request.runId },
      attemptId: { enumerable: true, value: request.attemptId },
      kind: { enumerable: true, value: request.kind },
      priority: { enumerable: true, value: request.priority },
      status: { enumerable: true, value: "rejected" },
      state: { enumerable: true, value: "rejected" },
      lease: { enumerable: true, value: null },
      promise: { enumerable: false, value: promise },
      cancel: { enumerable: true, value: () => false },
    });
    return promise;
  }

  /**
   * @param {unknown} target
   * @returns {AdmissionEntry | null}
   */
  function findEntry(target) {
    if (target && typeof target === "object") {
      const candidate = /** @type {Record<string, unknown>} */ (target);
      const runId = String(candidate.runId ?? "").trim();
      const attemptId = String(candidate.attemptId ?? "").trim();
      const key = typeof candidate.key === "string" ? candidate.key : runId && attemptId ? admissionKey(runId, attemptId) : "";
      if (key) return queuedByKey.get(key) ?? activeByKey.get(key) ?? null;
    }
    if (typeof target !== "string") return null;
    if (queuedByKey.has(target)) return queuedByKey.get(target) ?? null;
    if (activeByKey.has(target)) return activeByKey.get(target) ?? null;
    let found = null;
    for (const entry of [...queuedByKey.values(), ...activeByKey.values()]) {
      if (entry.attemptId !== target) continue;
      if (found) return null;
      found = entry;
    }
    return found;
  }

  /**
   * Cancel a queued request. Active leases are intentionally not cancelled by
   * this method; provider cancellation belongs to the caller that owns the
   * active lease.
   *
   * @param {unknown} target
   * @param {string} [reason]
   * @returns {boolean}
   */
  function cancel(target, reason) {
    const entry = findEntry(target);
    return entry ? cancelEntry(entry, reason) : false;
  }

  /**
   * Release an active lease. Releasing the same lease (or key) repeatedly is
   * safe and returns false after the first release.
   *
   * @param {unknown} target
   * @returns {boolean}
   */
  function release(target) {
    const entry = findEntry(target);
    if (!entry) return false;
    return entry.lease ? entry.lease.release() : releaseEntry(entry);
  }

  /**
   * Close admission, rejecting all queued requests. Existing active leases are
   * left for their owners to release, which keeps provider cancellation and
   * process cleanup outside this pure admission module.
   *
   * @param {string | {reason?: string}} [input]
   * @returns {SchedulerSnapshot}
   */
  function close(input) {
    if (closed) return snapshot();
    closed = true;
    const reason = typeof input === "string" ? input : String(input?.reason ?? "Task attempt scheduler is closed");
    const waiting = [...queuedByKey.values()];
    for (const entry of waiting) {
      entry.state = "rejected";
      queuedByKey.delete(entry.key);
      removeFromQueue(entry);
      changeRunCount(entry.runId, "queued", -1);
      pruneRun(entry.runId);
      entry.reject(new SchedulerClosedError(reason));
    }
    highPriorityStreak = 0;
    const event = { reason, snapshot: snapshot() };
    invokeHook("onClose", event);
    invokeHook("onChange", { type: "close", ...event });
    return snapshot();
  }

  /** @returns {number} */
  function dispatchNow() {
    const before = activeByKey.size;
    dispatch();
    return activeByKey.size - before;
  }

  /**
   * Reconstruct queued admissions from durable ready-attempt rows after a
   * Supervisor restart. Existing keys remain idempotently owned by this
   * scheduler; callers can safely pass the same rows more than once.
   */
  function restore(entries = []) {
    if (!Array.isArray(entries)) throw new TypeError("scheduler restore entries must be an array");
    const tickets = [];
    // A restart must reconstruct the complete durable backlog before any
    // admission is granted. Otherwise the first database page can consume all
    // capacity and violate the pre-crash priority/fairness order.
    dispatchHold += 1;
    try {
      for (const input of entries) {
        if (!input || typeof input !== "object") continue;
        const candidate = /** @type {Record<string, unknown>} */ (input);
        const runId = String(candidate.runId ?? "").trim();
        const attemptId = String(candidate.attemptId ?? "").trim();
        const key = runId && attemptId ? admissionKey(runId, attemptId) : "";
        if (key && (queuedByKey.has(key) || activeByKey.has(key))) continue;
        const ticket = enqueue(input);
        if (ticket.state !== "rejected") tickets.push(ticket);
      }
    } finally {
      dispatchHold = Math.max(0, dispatchHold - 1);
    }
    dispatch();
    return tickets;
  }

  return {
    enqueue,
    request: enqueue,
    acquire: enqueue,
    submit: enqueue,
    cancel,
    release,
    close,
    dispatch: dispatchNow,
    restore,
    hydrate: restore,
    snapshot,
    getSnapshot: snapshot,
    metrics: snapshot,
    getMetrics: snapshot,
    get closed() {
      return closed;
    },
    get maxActiveAttempts() {
      return maxActiveAttempts;
    },
    get maxActive() {
      return maxActiveAttempts;
    },
    get reservedWorkerSlots() {
      return reservedWorkerSlots;
    },
    get active() {
      return activeByKey.size;
    },
    get queued() {
      return queuedByKey.size;
    },
    get peak() {
      return peak;
    },
  };
}

/** Alias kept for callers that name the component by its shorter role. */
export const createGlobalScheduler = createGlobalAdmissionScheduler;

/** Alias used by callers that name the limit around attempts explicitly. */
export const createGlobalAttemptScheduler = createGlobalAdmissionScheduler;

/** Alias used by Task Center's admission terminology. */
export const createTaskAdmissionScheduler = createGlobalAdmissionScheduler;

/** Alias for class-oriented consumers without introducing mutable state. */
export const createAdmissionScheduler = createGlobalAdmissionScheduler;
