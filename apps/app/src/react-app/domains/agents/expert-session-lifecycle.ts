/**
 * Pure Expert / multi-session lifecycle contracts.
 * UI and hooks must follow these rules; unit tests call this module directly.
 *
 * Documented in docs/Architecture.md (Session / Expert / cold-path pointers)
 * and docs/design/2026-08-09-architecture-convergence-plan.md Phase B.
 */

/** Draft composer sessions are not durable expert session tags. */
export function isDraftSessionId(sessionId: string): boolean {
  return sessionId.trim().startsWith("draft:");
}

/**
 * Hard-delete clears local expert session tags and agent bindings for real
 * session ids only — never draft: prefixes (composer staging).
 */
export function shouldClearLocalBindingOnDelete(sessionId: string): boolean {
  const id = sessionId.trim();
  return id.length > 0 && !isDraftSessionId(id);
}

/**
 * After hard-delete, expert session id set must not retain deleted ids
 * (blocks ghost tabs in the expert rail).
 */
export function remainingExpertSessionIdsAfterDelete(
  current: ReadonlySet<string> | readonly string[],
  deletedSessionIds: readonly string[],
): string[] {
  const deleted = new Set(
    deletedSessionIds
      .map((id) => id.trim())
      .filter((id) => shouldClearLocalBindingOnDelete(id)),
  );
  const list = Array.isArray(current) ? current : [...current];
  return list
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && !deleted.has(id));
}

/**
 * Creating an expert flushes the creation composer at most once per save path.
 * Callers pass whether a flush already ran for this save attempt.
 */
export function shouldFlushComposerOnExpertCreate(alreadyFlushed: boolean): boolean {
  return !alreadyFlushed;
}

/**
 * Selecting an expert only switches when the id is non-empty and different.
 * Prevents redundant select → double host remount thrash.
 */
export function shouldApplyExpertSelection(input: {
  nextExpertId: string;
  selectedExpertId: string | null | undefined;
}): boolean {
  const next = input.nextExpertId.trim();
  if (!next) return false;
  const current = (input.selectedExpertId ?? "").trim();
  return next !== current;
}

/**
 * Lifecycle hard rules (product contract).
 * Keep in sync with docs/Architecture.md Session / Expert pointers.
 */
export const EXPERT_SESSION_LIFECYCLE_RULES = {
  hardDeleteClearsBindings: true,
  hardDeleteSkipsDraftSessions: true,
  hardDeleteRefusesProductBuiltins: true,
  createComposerFlushOnce: true,
  selectIsNoopWhenUnchanged: true,
} as const;
