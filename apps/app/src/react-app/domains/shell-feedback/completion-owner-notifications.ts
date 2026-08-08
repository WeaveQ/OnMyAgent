/**
 * Completion-owner rules for desktop / in-app completion signals.
 *
 * Interactive Agent-ready alerts must not fire for sessions owned by
 * automation (or other non-interactive owners). Automation has its own
 * completion notifier with task-level copy.
 */

import {
  shouldNotifyAgentReadyTransition,
  type AgentActivityPhase,
} from "./agent-ready-desktop-notifications";

export type CompletionOwnerKind = "interactive" | "automation" | "unknown";

/**
 * Whether Agent-ready (interactive turn finished) should be suppressed for
 * this session because another product owner owns completion UX.
 */
export function shouldSuppressAgentReadyForOwner(input: {
  sessionId: string;
  automationOwnedSessionIds: ReadonlySet<string>;
}): boolean {
  const sessionId = input.sessionId.trim();
  if (!sessionId) return false;
  return input.automationOwnedSessionIds.has(sessionId);
}

/**
 * Full gate for Agent-ready desktop notification: activity transition + owner.
 * Callers that already know the phase transition may skip the phase re-check
 * by using {@link shouldSuppressAgentReadyForOwner} alone.
 */
export function shouldEmitAgentReadyDesktopNotification(input: {
  previous: AgentActivityPhase | undefined;
  next: AgentActivityPhase;
  sessionId: string;
  automationOwnedSessionIds: ReadonlySet<string>;
}): boolean {
  return (
    shouldNotifyAgentReadyTransition(input.previous, input.next) &&
    !shouldSuppressAgentReadyForOwner(input)
  );
}

export function resolveCompletionOwnerKind(input: {
  sessionId: string;
  automationOwnedSessionIds: ReadonlySet<string>;
}): CompletionOwnerKind {
  const sessionId = input.sessionId.trim();
  if (!sessionId) return "unknown";
  if (shouldSuppressAgentReadyForOwner(input)) return "automation";
  return "interactive";
}
