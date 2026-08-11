import { createHash } from "node:crypto";
import type {
  ExpertLifecycleContractAssertionEvent,
  ExpertLifecycleDeleteEvent,
  ExpertLifecycleDirectoryFetchEvent,
  ExpertLifecycleEvent,
  ExpertLifecycleEventInput,
  ExpertLifecycleEventOutcome,
  ExpertLifecycleEventPhase,
  ExpertLifecycleEventShadowChange,
  ExpertLifecycleEventSnapshot,
  ExpertLifecycleEventSource,
  ExpertLifecycleHealEvent,
  ExpertLifecycleMaterializeEvent,
  ExpertLifecycleMissingSkillsEvent,
  ExpertLifecycleShadowDiffEvent,
} from "@onmyagent/types/server";

export type {
  ExpertLifecycleEvent,
  ExpertLifecycleEventInput,
  ExpertLifecycleEventSnapshot,
} from "@onmyagent/types/server";

export const EXPERT_LIFECYCLE_EVENT_SCHEMA = "onmyagent.expert-lifecycle-events" as const;
export const EXPERT_LIFECYCLE_EVENT_VERSION = 1 as const;
export const EXPERT_LIFECYCLE_EVENT_CAPACITY = 512 as const;

const HASH_PREFIX = "sha256:";
const HASH_LENGTH = 16;

const OUTCOMES = new Set<ExpertLifecycleEventOutcome>([
  "started",
  "succeeded",
  "failed",
  "partial",
  "skipped",
]);
const PHASES = new Set<ExpertLifecycleEventPhase>([
  "requested",
  "fetch",
  "compare",
  "dry_run",
  "apply",
  "ensure",
  "assert",
  "forward",
  "opencode",
  "runtime",
  "tombstone",
  "complete",
]);
const SOURCES = new Set<ExpertLifecycleEventSource>([
  "workspace",
  "cache",
  "opencode",
  "runtime",
  "origin",
  "marker",
]);
const SHADOW_CHANGES = new Set<ExpertLifecycleEventShadowChange>([
  "added",
  "removed",
  "changed",
  "unchanged",
]);
const HEAL_ACTIONS = new Set<NonNullable<ExpertLifecycleHealEvent["action"]>>([
  "upgrade_marker",
  "write_origin",
  "restore_origin",
  "skip",
]);
const DELETE_STEPS = new Set<NonNullable<ExpertLifecycleDeleteEvent["step"]>>([
  "request",
  "opencode",
  "runtime",
  "tombstone",
  "complete",
]);
const ASSERTIONS = new Set<NonNullable<ExpertLifecycleContractAssertionEvent["assertion"]>>([
  "authorized_directory",
  "marker",
  "identity",
  "agent",
  "skills",
  "plugin_isolation",
  "prompt_budget",
]);

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hashIdentifier(value: unknown): string | undefined {
  const normalized = stringValue(value);
  if (!normalized) return undefined;
  return `${HASH_PREFIX}${createHash("sha256").update(normalized).digest("hex").slice(0, HASH_LENGTH)}`;
}

function safeHash(value: unknown): string | undefined {
  const normalized = stringValue(value);
  if (!normalized) return undefined;
  return /^(?:sha256:)?[a-f0-9]{16}$/i.test(normalized) ? normalized : undefined;
}

function safeEnum<T extends string>(value: unknown, values: ReadonlySet<T>): T | undefined {
  return typeof value === "string" && values.has(value as T) ? value as T : undefined;
}

function safeNumber(value: unknown, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > max) return undefined;
  return Number.isInteger(value) ? value : Math.round(value * 1000) / 1000;
}

function safeCode(value: unknown): string | undefined {
  const normalized = stringValue(value);
  if (!normalized || normalized.length > 64) return undefined;
  // Codes are intentionally allow-listed to prevent accidental message/path
  // or credential export through a field that looks harmless in diagnostics.
  if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(normalized)) return "redacted";
  if (/^(?:sk|pk|ghp|gho|ghs|glp|xoxb|xoxp)_[a-z0-9_-]{8,}$/i.test(normalized)) return "redacted";
  if (/(?:bearer|token|secret|password|api[_-]?key|authorization)/i.test(normalized)) return "redacted";
  return normalized;
}

function safeBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readCommon(input: RecordLike, sequence: number, timestamp: number): ExpertLifecycleEvent["kind"] extends never ? never : {
  sequence: number;
  timestamp: number;
  kind: ExpertLifecycleEvent["kind"];
  outcome?: ExpertLifecycleEventOutcome;
  phase?: ExpertLifecycleEventPhase;
  source?: ExpertLifecycleEventSource;
  workspaceHash?: string;
  expertHash?: string;
  sessionHash?: string;
  code?: string;
  durationMs?: number;
  count?: number;
} {
  const workspaceHash = safeHash(input.workspaceHash) ?? hashIdentifier(input.workspaceId);
  const expertHash = safeHash(input.expertHash) ?? hashIdentifier(input.expertId);
  const sessionHash = safeHash(input.sessionHash) ?? hashIdentifier(input.sessionId);
  const outcome = safeEnum(input.outcome, OUTCOMES);
  const phase = safeEnum(input.phase, PHASES);
  const source = safeEnum(input.source, SOURCES);
  const code = safeCode(input.code);
  const durationMs = safeNumber(input.durationMs, 86_400_000);
  const count = safeNumber(input.count, 1_000_000);
  return {
    sequence,
    timestamp,
    kind: input.kind as ExpertLifecycleEvent["kind"],
    ...(outcome ? { outcome } : {}),
    ...(phase ? { phase } : {}),
    ...(source ? { source } : {}),
    ...(workspaceHash ? { workspaceHash } : {}),
    ...(expertHash ? { expertHash } : {}),
    ...(sessionHash ? { sessionHash } : {}),
    ...(code ? { code } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(count !== undefined ? { count } : {}),
  };
}

function readTimestamp(input: RecordLike, fallback: number): number {
  return safeNumber(input.timestamp, 8_640_000_000_000_000) ?? fallback;
}

/**
 * Convert an untrusted producer payload into the allow-listed event contract.
 * Unknown keys (including prompt/body/token/secret/path/content fields) are
 * ignored. Identifiers are hashed before the returned object is created.
 */
export function sanitizeExpertLifecycleEvent(
  input: unknown,
  options: { sequence?: number; timestamp?: number } = {},
): ExpertLifecycleEvent | null {
  if (!isRecord(input)) return null;
  const kind = input.kind;
  const sequence = safeNumber(options.sequence, Number.MAX_SAFE_INTEGER) ?? 0;
  const timestamp = readTimestamp(input, safeNumber(options.timestamp, 8_640_000_000_000_000) ?? Date.now());
  const common = readCommon(input, sequence, timestamp);

  switch (kind) {
    case "directory_fetch": {
      const event: ExpertLifecycleDirectoryFetchEvent = {
        ...common,
        kind,
        ...(safeEnum(input.source, SOURCES) ? { source: safeEnum(input.source, SOURCES) } : {}),
        ...(safeBool(input.complete) !== undefined ? { complete: safeBool(input.complete) } : {}),
        ...(safeNumber(input.failureCount, 1_000_000) !== undefined ? { failureCount: safeNumber(input.failureCount, 1_000_000) } : {}),
      };
      return event;
    }
    case "shadow_diff": {
      const change = safeEnum(input.change, SHADOW_CHANGES);
      if (!change) return null;
      const event: ExpertLifecycleShadowDiffEvent = {
        ...common,
        kind,
        change,
        ...(safeNumber(input.changedFieldCount, 1_000_000) !== undefined ? { changedFieldCount: safeNumber(input.changedFieldCount, 1_000_000) } : {}),
      };
      return event;
    }
    case "heal": {
      const event: ExpertLifecycleHealEvent = {
        ...common,
        kind,
        ...(safeEnum(input.action, HEAL_ACTIONS) ? { action: safeEnum(input.action, HEAL_ACTIONS) } : {}),
        ...(safeNumber(input.failureCount, 1_000_000) !== undefined ? { failureCount: safeNumber(input.failureCount, 1_000_000) } : {}),
      };
      return event;
    }
    case "materialize": {
      const event: ExpertLifecycleMaterializeEvent = {
        ...common,
        kind,
        ...(safeNumber(input.declaredSkillCount, 1_000_000) !== undefined ? { declaredSkillCount: safeNumber(input.declaredSkillCount, 1_000_000) } : {}),
        ...(safeNumber(input.installedSkillCount, 1_000_000) !== undefined ? { installedSkillCount: safeNumber(input.installedSkillCount, 1_000_000) } : {}),
        ...(safeNumber(input.missingSkillCount, 1_000_000) !== undefined ? { missingSkillCount: safeNumber(input.missingSkillCount, 1_000_000) } : {}),
      };
      return event;
    }
    case "contract_assertion": {
      const event: ExpertLifecycleContractAssertionEvent = {
        ...common,
        kind,
        ...(safeEnum(input.assertion, ASSERTIONS) ? { assertion: safeEnum(input.assertion, ASSERTIONS) } : {}),
      };
      return event;
    }
    case "delete": {
      const event: ExpertLifecycleDeleteEvent = {
        ...common,
        kind,
        ...(safeEnum(input.step, DELETE_STEPS) ? { step: safeEnum(input.step, DELETE_STEPS) } : {}),
        ...(safeNumber(input.failureCount, 1_000_000) !== undefined ? { failureCount: safeNumber(input.failureCount, 1_000_000) } : {}),
      };
      return event;
    }
    case "missing_skills": {
      const event: ExpertLifecycleMissingSkillsEvent = {
        ...common,
        kind,
        ...(safeNumber(input.declaredSkillCount, 1_000_000) !== undefined ? { declaredSkillCount: safeNumber(input.declaredSkillCount, 1_000_000) } : {}),
        ...(safeNumber(input.missingSkillCount, 1_000_000) !== undefined ? { missingSkillCount: safeNumber(input.missingSkillCount, 1_000_000) } : {}),
      };
      return event;
    }
    default:
      return null;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function cloneEvent(event: ExpertLifecycleEvent): ExpertLifecycleEvent {
  return { ...event } as ExpertLifecycleEvent;
}

export interface ExpertLifecycleEventRingOptions {
  now?: () => number;
}

/** Process-local, fixed-capacity Expert lifecycle event ring. */
export class ExpertLifecycleEventRing {
  private readonly now: () => number;
  private events: ExpertLifecycleEvent[] = [];
  private nextSequence = 1;

  constructor(options: ExpertLifecycleEventRingOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.events.length;
  }

  record(input: ExpertLifecycleEventInput): ExpertLifecycleEvent {
    const event = sanitizeExpertLifecycleEvent(input, {
      sequence: this.nextSequence,
      timestamp: this.now(),
    });
    if (!event) throw new TypeError("Invalid Expert lifecycle event");
    this.nextSequence += 1;
    this.events.push(event);
    if (this.events.length > EXPERT_LIFECYCLE_EVENT_CAPACITY) {
      this.events.splice(0, this.events.length - EXPERT_LIFECYCLE_EVENT_CAPACITY);
    }
    return cloneEvent(event);
  }

  snapshot(): ExpertLifecycleEventSnapshot {
    return {
      schema: EXPERT_LIFECYCLE_EVENT_SCHEMA,
      version: EXPERT_LIFECYCLE_EVENT_VERSION,
      capacity: EXPERT_LIFECYCLE_EVENT_CAPACITY,
      nextSequence: this.nextSequence,
      events: this.events.map(cloneEvent),
    };
  }

  export(): string {
    return stableStringify(this.snapshot());
  }

  reset(): void {
    this.events = [];
    this.nextSequence = 1;
  }
}

export const expertLifecycleEventRing = new ExpertLifecycleEventRing();
/** Alias used by status/diagnostics integrations. */
export const expertLifecycleEvents = expertLifecycleEventRing;

export function recordExpertLifecycleEvent(input: ExpertLifecycleEventInput): ExpertLifecycleEvent {
  return expertLifecycleEventRing.record(input);
}

export function getExpertLifecycleEventsSnapshot(): ExpertLifecycleEventSnapshot {
  return expertLifecycleEventRing.snapshot();
}

export const getExpertLifecycleEventSnapshot = getExpertLifecycleEventsSnapshot;

export function exportExpertLifecycleEvents(): string {
  return expertLifecycleEventRing.export();
}

export function exportExpertLifecycleEventsSnapshot(): ExpertLifecycleEventSnapshot {
  return expertLifecycleEventRing.snapshot();
}

/** Test-only reset; production callers must not clear diagnostics. */
export function resetExpertLifecycleEventsForTest(): void {
  expertLifecycleEventRing.reset();
}
