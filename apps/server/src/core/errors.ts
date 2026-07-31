import type { ApiErrorBody } from "@onmyagent/types/server";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    // ESM / multi-realm instanceof can fail after dynamic import reloads.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Duck-type check so dual-module loads still recognize ApiError. */
export function isApiError(error: unknown): error is ApiError {
  if (error instanceof ApiError) return true;
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; status?: unknown; code?: unknown; message?: unknown };
  return (
    value.name === "ApiError" &&
    typeof value.status === "number" &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}

export function formatError(err: ApiError): ApiErrorBody {
  return {
    code: err.code,
    message: err.message,
    details: err.details,
  };
}

/** Normalize unknown throws into ApiError, preserving message when possible. */
export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  if (error instanceof Error && error.message.trim()) {
    return new ApiError(500, "internal_error", error.message);
  }
  return new ApiError(500, "internal_error", "Unexpected server error");
}
