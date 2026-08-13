// @ts-check

const REQUEST_ID_KEYS = Object.freeze([
  "requestId",
  "request_id",
  "requestID",
  "providerRequestId",
  "providerRequestID",
  "provider_request_id",
  "acpRequestId",
  "acpRequestID",
  "acp_request_id",
]);
const WARNING_KEYS = Object.freeze([
  "warning",
  "fallbackWarning",
  "fallbackWarnings",
  "warnings",
  "transportWarning",
  "message",
  "text",
  "output",
  "content",
]);
const FALLBACK_WARNING = /falling\s+back\b[\s\S]{0,240}?(?:transport|https|websocket|websockets)/gi;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,239}$/;
const MAX_TAIL = 512;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeRequestId(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text || /[\u0000-\u001f\u007f\\/]/.test(text) || !SAFE_REQUEST_ID.test(text)) return null;
  if (/(?:secret|token|password|api[_-]?key|authorization)/i.test(text)) return null;
  return text;
}

/** Only explicit ACP/provider request-id fields are eligible; arbitrary text is ignored. */
export function extractProviderRequestId(value) {
  if (!isRecord(value)) return null;
  for (const key of REQUEST_ID_KEYS) {
    const candidate = safeRequestId(value[key]);
    if (candidate) return candidate;
  }
  return null;
}

function warningText(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.slice(0, 32).forEach((item) => warningText(item, output));
  else if (isRecord(value)) {
    for (const key of WARNING_KEYS) if (Object.prototype.hasOwnProperty.call(value, key)) warningText(value[key], output);
    // Prompt-result adapters often nest their warning under `result` or
    // `metadata`; recurse only through those allowlisted containers.
    for (const key of ["result", "promptResult", "metadata"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) warningText(value[key], output);
    }
  }
  return output;
}

function explicitRequestIdFromPayload(value, depth = 0) {
  const direct = extractProviderRequestId(value);
  if (direct) return direct;
  if (!isRecord(value) || depth >= 3) return null;
  // ACP/provider envelopes keep metadata under these bounded containers. Do
  // not recurse through arbitrary payloads or infer an ID from free-form text.
  for (const key of ["metadata", "result", "promptResult", "params", "input"]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const nested = explicitRequestIdFromPayload(value[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

/**
 * Stateful fallback warning counter.  A warning split across chunks is held
 * in a bounded tail; after a complete match, the consumed prefix is dropped,
 * so a repeated warning is counted once per physical occurrence.
 */
export function createFallbackWarningAccumulator() {
  let tail = "";
  let count = 0;
  return {
    push(value) {
      const combined = `${tail}${String(value ?? "")}`;
      FALLBACK_WARNING.lastIndex = 0;
      let consumed = 0;
      let match;
      while ((match = FALLBACK_WARNING.exec(combined))) {
        count += 1;
        consumed = match.index + match[0].length;
      }
      tail = combined.slice(consumed).slice(-MAX_TAIL);
      return count;
    },
    count() { return count; },
    snapshot() { return { count, tail }; },
  };
}

/** Observe explicit request IDs and warning-bearing prompt results together. */
export function createProviderRequestDiagnosticsAccumulator() {
  const fallback = createFallbackWarningAccumulator();
  let requestId = null;
  return {
    observe(value = {}) {
      const explicit = explicitRequestIdFromPayload(value);
      if (explicit) requestId = explicit;
      for (const warning of warningText(value)) fallback.push(warning);
      return { requestId, fallbackCount: fallback.count() };
    },
    observePromptResult(value) {
      for (const warning of warningText({ promptResult: value })) fallback.push(warning);
      const explicit = explicitRequestIdFromPayload(value);
      if (explicit) requestId = explicit;
      return { requestId, fallbackCount: fallback.count() };
    },
    snapshot() { return { requestId, fallbackCount: fallback.count() }; },
  };
}

export const extractExplicitProviderRequestId = extractProviderRequestId;
export const createFallbackAccumulator = createFallbackWarningAccumulator;
