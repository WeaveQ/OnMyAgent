/**
 * Lightweight SSE change tokens for session-archive watch/events.
 * Version keys must not stringify full session/timing/stats objects.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scalar(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/**
 * Token for session watch streams: session row scalars + timing counters.
 * Omits turns/by_category/message bodies that made full JSON.stringify expensive.
 */
export function archiveSessionWatchVersion(session: unknown, timing: unknown): string {
  const s = isRecord(session) ? session : {};
  const t = isRecord(timing) ? timing : {};
  const slowest = isRecord(t.slowest_call) ? t.slowest_call : {};
  return [
    scalar(s.id),
    scalar(s.message_count),
    scalar(s.user_message_count),
    scalar(s.started_at),
    scalar(s.ended_at),
    scalar(s.deleted_at),
    scalar(s.display_name),
    scalar(s.session_name),
    scalar(s.local_modified_at),
    scalar(s.file_mtime),
    scalar(s.file_hash),
    scalar(s.file_size),
    scalar(s.total_output_tokens),
    scalar(s.peak_context_tokens),
    scalar(s.termination_status),
    scalar(t.total_duration_ms),
    scalar(t.tool_duration_ms),
    scalar(t.turn_count),
    scalar(t.tool_call_count),
    scalar(t.subagent_count),
    scalar(t.running),
    scalar(slowest.duration_ms),
    scalar(slowest.tool_name),
  ].join("\x1f");
}

/** Token for workspace-level archive events stream (stats only). */
export function archiveStatsVersion(stats: unknown): string {
  const st = isRecord(stats) ? stats : {};
  return [
    scalar(st.session_count),
    scalar(st.message_count),
    scalar(st.project_count),
    scalar(st.machine_count),
    scalar(st.earliest_session),
  ].join("\x1f");
}
