import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

const PINNED_PROVIDER_ORDER = ["opencode", "openai", "anthropic"] as const;

/**
 * Canonical vision model ids. Variants (preview / free / date / 32k) match
 * by containment after normalizing `.` and `-`. Do not list those suffixes here.
 */
const KNOWN_VISION_MODEL_IDS = [
  "ark-code-latest",
  "claude-3-5-haiku",
  "claude-fable-5",
  "claude-haiku-4-5",
  "claude-opus-4-1",
  "claude-opus-4-5",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-sonnet-4",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "gemini-3-flash",
  "gemini-3-pro",
  "gemini-3.1-pro",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gpt-5",
  "gpt-5-nano",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.4-pro",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "grok-4.5",
  "grok-4.6",
  "grok-build-0.1",
  "kimi-k2.5",
  "kimi-k2.6",
  "kimi-k3",
  "mimo-v2-omni-free",
  "mimo-v2.5-free",
  "minimax-m3",
  "muse-spark-1.2",
  "qwen3.5-plus",
  "qwen3.6-plus",
  "qwen3.7-flash",
  "qwen3.7-plus",
  "qwen3.8-27b",
  "qwen3.8-max",
  "doubao-1.5-vision-pro",
  "doubao-seed-1.6",
  "doubao-seed-1.6-flash",
  "doubao-seed-1.6-thinking",
  "doubao-seed-1.6-vision",
  "doubao-seed-1.8",
  "doubao-seed-2.0-lite",
  "doubao-seed-2.0-mini",
  "doubao-seed-2.0-pro",
  "doubao-seed-2.1-pro",
  "doubao-seed-2.1-turbo",
  "doubao-seed-character",
  "doubao-seed-evolving",
  "seed-1.6",
  "seed-1.6-flash",
  "seed-1.8",
  "seed-2.0-lite",
  "seed-2.0-mini",
  "seed-2.0-pro",
  "seed-2.1-turbo",
];

function catalogModelId(value: string): string {
  return value.trim().toLowerCase().replace(/^.*\//, "").replace(/:.*$/, "").replace(/\./g, "-");
}

const KNOWN_VISION_IDS_NORMALIZED = KNOWN_VISION_MODEL_IDS
  .map(catalogModelId)
  .sort((a, b) => b.length - a.length);

function isAllowedIdVariantSuffix(rest: string): boolean {
  if (/(^|-)(code|codex|coder)(-|$)/.test(rest)) return false;
  return /^(?:preview|free|32k|\d{6,8})(?:-(?:preview|free|32k|\d{6,8}))*$/.test(rest);
}

function idMatchesKnownVision(id: string): boolean {
  const live = catalogModelId(id);
  if (!live) return false;
  for (const known of KNOWN_VISION_IDS_NORMALIZED) {
    if (live === known) return true;
    if (live.startsWith(`${known}-`) && isAllowedIdVariantSuffix(live.slice(known.length + 1))) {
      return true;
    }
  }
  return false;
}

/**
 * True when the live catalog lists image/vision input, or the model id is a
 * known vision entry. Do not infer from `attachment: true` alone.
 */
export function modelSupportsVision(
  model:
    | {
        id?: unknown;
        attachment?: unknown;
        modalities?: { input?: unknown } | null;
      }
    | null
    | undefined,
  modelId?: string,
): boolean {
  const input = model?.modalities && typeof model.modalities === "object"
    ? model.modalities.input
    : undefined;
  if (Array.isArray(input)) {
    const listed = input.some((item) => {
      const value = String(item).trim().toLowerCase();
      return value === "image" || value === "images" || value === "vision";
    });
    if (listed) return true;
  }
  const id = catalogModelId(modelId ?? String(model?.id ?? ""));
  return id.length > 0 && idMatchesKnownVision(id);
}

/** Free tier: OpenCode Zen zero-cost entries, or name/id containing "free". */
export function isProviderModelFree(input: {
  providerId: string;
  modelId: string;
  model?: { name?: string; cost?: { input?: number; output?: number } } | null;
}): boolean {
  const name = `${input.model?.name ?? ""} ${input.modelId}`.toLowerCase();
  if (/\bfree\b/.test(name)) return true;
  if (input.providerId.trim().toLowerCase() !== "opencode") return false;
  const cost = input.model?.cost;
  if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") {
    return false;
  }
  return cost.input === 0 && cost.output === 0;
}

export const providerPriorityRank = (id: string) => {
  const normalized = id.trim().toLowerCase();
  const index = PINNED_PROVIDER_ORDER.indexOf(
    normalized as (typeof PINNED_PROVIDER_ORDER)[number],
  );
  return index === -1 ? PINNED_PROVIDER_ORDER.length : index;
};

export const compareProviders = (
  a: { id: string; name?: string },
  b: { id: string; name?: string },
) => {
  const rankDiff = providerPriorityRank(a.id) - providerPriorityRank(b.id);
  if (rankDiff !== 0) return rankDiff;

  const aName = (a.name ?? a.id).trim();
  const bName = (b.name ?? b.id).trim();
  return aName.localeCompare(bName);
};

export const filterProviderList = (
  value: ProviderListResponse,
  disabledProviders: string[],
): ProviderListResponse => {
  const disabled = new Set(disabledProviders.flatMap((id) => {
    const trimmed = id.trim();
    return trimmed ? [trimmed] : [];
  }));
  if (!disabled.size) return value;
  return {
    all: value.all.filter((provider) => !disabled.has(provider.id)),
    connected: value.connected.filter((id) => !disabled.has(id)),
    default: Object.fromEntries(
      Object.entries(value.default).filter(([id]) => !disabled.has(id)),
    ),
  };
};
