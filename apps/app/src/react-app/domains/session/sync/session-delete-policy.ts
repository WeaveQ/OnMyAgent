/**
 * Session delete policy: resolve directory + decide which remote failures
 * still allow local sidebar/expert cleanup (dirty / ghost rows).
 */

export function resolveSessionDeleteDirectory(input: {
  assistantDirectory?: string | null;
  sessionDirectory?: string | null;
  workspaceRoot?: string | null;
}): string | undefined {
  for (const candidate of [
    input.assistantDirectory,
    input.sessionDirectory,
    input.workspaceRoot,
  ]) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (trimmed) return trimmed;
  }
  return undefined;
}

function readErrorFields(error: unknown): {
  status: number | null;
  code: string;
  message: string;
  name: string;
} {
  if (!error || typeof error !== "object") {
    return {
      status: null,
      code: "",
      message: error instanceof Error ? error.message : String(error ?? ""),
      name: error instanceof Error ? error.name : "",
    };
  }
  const record = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const status =
    typeof record.status === "number" && Number.isFinite(record.status)
      ? record.status
      : null;
  return {
    status,
    code: String(record.code ?? "").toLowerCase(),
    message: String(record.message ?? "").toLowerCase(),
    name: String(record.name ?? "").toLowerCase(),
  };
}

/**
 * Remote delete failures that should not block local cleanup.
 * Ghost sidebar rows, wrong directory, OpenCode empty/502, timeouts, and
 * transient network errors are all "dirty data" the user is trying to clear.
 */
export function isTolerableSessionDeleteFailure(error: unknown): boolean {
  const { status, code, message, name } = readErrorFields(error);

  if (
    status === 400 ||
    status === 404 ||
    status === 408 ||
    status === 410 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return true;
  }

  if (
    code === "session_not_found" ||
    code === "not_found" ||
    code === "opencode_request_failed" ||
    code === "opencode_empty_response" ||
    code === "timeout" ||
    code === "aborted" ||
    code === "network_error" ||
    code === "fetch_failed"
  ) {
    return true;
  }

  if (
    name === "aborterror" ||
    name === "timeouterror" ||
    name === "typeerror"
  ) {
    return true;
  }

  if (
    /not found|session_not_found|404|410|502|503|504|timeout|timed out|abort|network|failed to fetch|econnrefused|econnreset|empty response|opencode/i.test(
      message,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Whether delete UI should treat remote outcome as done and always finish
 * local cleanup. Product choice for dirty rows: yes for any failure class
 * we tolerate; rethrow only for unexpected non-tolerable errors is optional
 * at the call site (callers may still always clean local state).
 */
export function shouldContinueLocalSessionCleanupAfterRemoteDelete(
  error: unknown | null,
): boolean {
  if (error == null) return true;
  return isTolerableSessionDeleteFailure(error);
}
