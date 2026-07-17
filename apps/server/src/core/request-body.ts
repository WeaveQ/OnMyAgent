import { ApiError } from "./errors.js";

export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const json = await request.json();
    return json as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "Invalid JSON body");
  }
}

export function readBodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export function readOptionalBodyString(body: Record<string, unknown>, key: string): string | undefined {
  const trimmed = readBodyString(body, key).trim();
  return trimmed || undefined;
}

export function readRequiredBodyString(body: Record<string, unknown>, key: string): string {
  const trimmed = readOptionalBodyString(body, key);
  if (!trimmed) throw new ApiError(400, "invalid_request", `${key} is required`);
  return trimmed;
}

export function readOptionalBodyNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) throw new ApiError(400, "invalid_request", `${key} must be a number`);
  return parsed;
}

export function readRequiredBodyBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") throw new ApiError(400, "invalid_request", `${key} must be a boolean`);
  return value;
}

export function readBodyStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ApiError(400, "invalid_request", `${key} must be an array`);
  return value.map((entry) => String(entry));
}

export function readBodyModel(body: Record<string, unknown>): { providerID: string; modelID: string } | undefined {
  const value = body.model;
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "invalid_request", "model must be an object");
  const record = value as Record<string, unknown>;
  const providerID = typeof record.providerID === "string" ? record.providerID.trim() : "";
  const modelID = typeof record.modelID === "string" ? record.modelID.trim() : "";
  if (!providerID || !modelID) throw new ApiError(400, "invalid_request", "model.providerID and model.modelID are required");
  return { providerID, modelID };
}

export function readBodyBooleanMap(body: Record<string, unknown>, key: string): Record<string, boolean> | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "invalid_request", `${key} must be an object`);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => {
    if (typeof entryValue !== "boolean") throw new ApiError(400, "invalid_request", `${key}.${entryKey} must be a boolean`);
    return [entryKey, entryValue] as const;
  }));
}

export function readTeamCommentKind(body: Record<string, unknown>): "comment" | "decision" | "question" | "progress" | undefined {
  const kind = readOptionalBodyString(body, "kind");
  if (!kind) return undefined;
  if (kind === "comment" || kind === "decision" || kind === "question" || kind === "progress") return kind;
  throw new ApiError(400, "invalid_request", "kind must be comment, decision, question, or progress");
}

export function parseOptionalPositiveInteger(
  value: string | null,
  name: string,
): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(
      400,
      "invalid_query",
      `${name} must be a positive integer`,
    );
  }
  return parsed;
}

export function parseOptionalNonNegativeInteger(
  value: string | null,
  name: string,
): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApiError(
      400,
      "invalid_query",
      `${name} must be a non-negative integer`,
    );
  }
  return parsed;
}

export function parseOptionalBoolean(
  value: string | null,
  name: string,
): boolean | undefined {
  if (value === null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new ApiError(400, "invalid_query", `${name} must be a boolean`);
}

export function ensurePlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
