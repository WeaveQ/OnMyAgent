import { ApiError, isApiError } from "../core/errors.js";
import {
  grokExtensionFor,
  type GrokExtensionFeature,
} from "./grok-extension-registry.js";

type JsonObject = Record<string, unknown>;

export type GrokExtensionCallResult<T> =
  | { ok: true; value: T; method: string; complete: true }
  | { ok: false; complete: false; unavailable: true; method: string; code: string };

export type GrokExtensionTransport = {
  request(method: string, params: JsonObject, timeoutMs?: number): Promise<unknown>;
};

const JSON_RPC_METHOD_NOT_FOUND = -32601;

export function jsonRpcCodeFromError(error: unknown): number | undefined {
  if (!isApiError(error)) return undefined;
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const code = (details as { jsonRpcCode?: unknown }).jsonRpcCode;
  return typeof code === "number" && Number.isInteger(code) ? code : undefined;
}

export function isMethodMissing(error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (error.code === "agent_runtime_capability_unsupported") return true;
  return jsonRpcCodeFromError(error) === JSON_RPC_METHOD_NOT_FOUND;
}

export class GrokExtensionClient {
  readonly #transport: GrokExtensionTransport;

  constructor(transport: GrokExtensionTransport) {
    this.#transport = transport;
  }

  async call<T>(
    feature: GrokExtensionFeature,
    params: JsonObject,
    decode: (value: unknown) => T,
  ): Promise<GrokExtensionCallResult<T>> {
    const definition = grokExtensionFor(feature);
    const methods = [...definition.methods, ...(definition.aliases ?? [])];
    let lastError: unknown;
    for (const method of methods) {
      try {
        const raw = await this.#transport.request(method, params);
        return { ok: true, value: decode(raw), method, complete: true };
      } catch (error) {
        lastError = error;
        if (isMethodMissing(error)) continue;
        throw error;
      }
    }
    if (definition.safety === "read") {
      return {
        ok: false,
        complete: false,
        unavailable: true,
        method: methods[0]!,
        code: lastError instanceof ApiError ? lastError.code : "grok_extension_unavailable",
      };
    }
    throw lastError instanceof ApiError
      ? lastError
      : new ApiError(
        409,
        "agent_runtime_capability_unsupported",
        `Grok extension ${feature} is unavailable`,
      );
  }
}
