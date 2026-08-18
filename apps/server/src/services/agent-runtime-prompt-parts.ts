import { ApiError } from "../core/errors.js";
import type { AgentRuntimePromptPartInput } from "@onmyagent/types/agent-runtime";

const PUBLISHED_PART_TYPES = [
  "text",
  "file",
  "resource_link",
  "staged_file",
  "image",
  "agent",
] as const;

export const publishedAgentRuntimePromptPartTypes = PUBLISHED_PART_TYPES;

function invalidPayload(message: string): ApiError {
  return new ApiError(400, "invalid_payload", message);
}

function requiredBoundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw invalidPayload(`${label} is invalid`);
  }
  return value;
}

function optionalBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return requiredBoundedString(value, label, maxLength);
}

function requiredStagedPath(value: unknown, label: string): string {
  const path = requiredBoundedString(value, label, 16_000);
  if (path.includes("\0") || path.split(/[\\/]/).includes("..")) {
    throw invalidPayload(`${label} is invalid`);
  }
  return path;
}

/** Production HTTP parser for AgentRuntimePromptPartInput. */
export function parsePromptParts(value: unknown): AgentRuntimePromptPartInput[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw invalidPayload("parts is invalid");
  }
  return value.map((entry) => parsePromptPart(entry));
}

export function parsePromptPart(value: unknown): AgentRuntimePromptPartInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidPayload("parts is invalid");
  }
  const part = value as Record<string, unknown>;
  if (part.type === "text") {
    return { type: "text", text: requiredBoundedString(part.text, "part text", 512 * 1024) };
  }
  if (part.type === "agent") {
    return { type: "agent", name: requiredBoundedString(part.name, "agent name", 200) };
  }
  if (part.type === "file") {
    return {
      type: "file",
      url: requiredBoundedString(part.url, "file url", 1024 * 1024),
      ...(part.filename === undefined
        ? {}
        : { filename: requiredBoundedString(part.filename, "filename", 500) }),
      mime: requiredBoundedString(part.mime, "mime", 200),
    };
  }
  if (part.type === "resource_link") {
    return {
      type: "resource_link",
      uri: requiredBoundedString(part.uri, "resource uri", 1024 * 1024),
      ...(optionalBoundedString(part.filename, "filename", 500)
        ? { filename: optionalBoundedString(part.filename, "filename", 500) }
        : {}),
      ...(optionalBoundedString(part.mime, "mime", 200)
        ? { mime: optionalBoundedString(part.mime, "mime", 200) }
        : {}),
    };
  }
  if (part.type === "staged_file") {
    return {
      type: "staged_file",
      path: requiredStagedPath(part.path, "staged path"),
      ...(optionalBoundedString(part.filename, "filename", 500)
        ? { filename: optionalBoundedString(part.filename, "filename", 500) }
        : {}),
      ...(optionalBoundedString(part.mime, "mime", 200)
        ? { mime: optionalBoundedString(part.mime, "mime", 200) }
        : {}),
    };
  }
  if (part.type === "image") {
    const url = optionalBoundedString(part.url, "image url", 1024 * 1024);
    const path = part.path === undefined ? undefined : requiredStagedPath(part.path, "image path");
    if (!url && !path) throw invalidPayload("image part requires url or path");
    return {
      type: "image",
      ...(url ? { url } : {}),
      ...(path ? { path } : {}),
      ...(optionalBoundedString(part.filename, "filename", 500)
        ? { filename: optionalBoundedString(part.filename, "filename", 500) }
        : {}),
      ...(optionalBoundedString(part.mime, "mime", 200)
        ? { mime: optionalBoundedString(part.mime, "mime", 200) }
        : {}),
    };
  }
  throw invalidPayload("parts is invalid");
}
