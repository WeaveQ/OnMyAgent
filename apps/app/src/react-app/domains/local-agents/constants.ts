import type { PersonalLocalAgentProvider } from "../../../app/lib/desktop";

/**
 * Display labels for each local-agent provider. Single source of truth shared
 * by the page model and the run-summary formatters so the label map is never
 * duplicated or drifted between modules.
 */
export const PROVIDER_LABELS: Record<PersonalLocalAgentProvider, string> = {
  opencode: "OpenCode",
  codex: "Codex",
  claude: "Claude Code",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  custom: "Custom",
};

export function isPersonalLocalAgentProvider(value: string): value is PersonalLocalAgentProvider {
  return Object.prototype.hasOwnProperty.call(PROVIDER_LABELS, value);
}

/**
 * Errors returned by the native-session transcript reader that should be
 * treated as "no transcript to hydrate" rather than a hard failure surfaced
 * to the user. Keeping them in one set makes the soft-error policy explicit
 * and unit-testable.
 */
export const TRANSCRIPT_SOFT_ERRORS: ReadonlySet<string> = new Set([
  "This provider does not expose a stable native transcript.",
  // Provider session file may have been rotated / cleaned up / never existed
  // (e.g. a channel-bound conversation whose Codex rollout was pruned). Treat
  // as "no transcript to hydrate" instead of surfacing a red banner.
  "Codex session transcript file was not found.",
  "Claude session transcript file was not found.",
]);

export function isUnsupportedNativeTranscriptError(error: string | null | undefined): boolean {
  if (!error) return false;
  return TRANSCRIPT_SOFT_ERRORS.has(error);
}
