import { createAvatar } from "@dicebear/core";
import * as adventurer from "@dicebear/adventurer";
import * as bottts from "@dicebear/bottts";
import * as lorelei from "@dicebear/lorelei";
import * as pixelArt from "@dicebear/pixel-art";

import type { AgentAvatarStyle } from "./pending-agent-store";
import type { AgentModelProvider, AgentRegistry } from "./agent-registry-types";

/** Legacy Chinese avatar style ids still present in stored registry/generated ids. */
const LEGACY_AVATAR_STYLE_ALIASES: Record<string, AgentAvatarStyle> = {
  pixel: "pixel",
  adventurer: "adventurer",
  robot: "robot",
  lorelei: "lorelei",
  // 像素风 / 冒险家 / 机器人 / 洛蕾莱
  "\u50CF\u7D20\u98CE": "pixel",
  "\u5192\u9669\u5BB6": "adventurer",
  "\u673A\u5668\u4EBA": "robot",
  "\u6D1B\u857E\u83B1": "lorelei",
};

const GENERATED_AVATAR_ID_RE =
  /^generated:(pixel|adventurer|robot|lorelei|\u50CF\u7D20\u98CE|\u5192\u9669\u5BB6|\u673A\u5668\u4EBA|\u6D1B\u857E\u83B1):(\d+):(\d+)$/;

export function normalizeAgentAvatarStyle(
  value: unknown,
): AgentAvatarStyle | null {
  if (typeof value !== "string") return null;
  return LEGACY_AVATAR_STYLE_ALIASES[value] ?? null;
}

export function buildAgentAvatarDataUri(
  style: AgentAvatarStyle,
  seed: string,
): string {
  const options = { seed, radius: 50 };
  const normalized = normalizeAgentAvatarStyle(style) ?? style;
  switch (normalized) {
    case "pixel":
      return createAvatar(pixelArt, options).toDataUri();
    case "adventurer":
      return createAvatar(adventurer, options).toDataUri();
    case "robot":
      return createAvatar(bottts, options).toDataUri();
    case "lorelei":
      return createAvatar(lorelei, options).toDataUri();
  }
}

export function resolveAgentAvatarUrl(
  input: {
    avatarStyle: AgentAvatarStyle;
    avatarOptionId: string;
    customAvatarDataUrl: string | null;
  },
  registry?: AgentRegistry | null,
): { url: string | null; background: string | null } {
  if (input.customAvatarDataUrl) {
    return { url: input.customAvatarDataUrl, background: null };
  }
  const avatarStyle =
    normalizeAgentAvatarStyle(input.avatarStyle) ?? input.avatarStyle;
  const matchedOption = registry?.avatars.find(
    (item) => item.id === input.avatarOptionId,
  );
  const seed =
    matchedOption?.label ??
    lookupGeneratedSeed(input.avatarOptionId) ??
    input.avatarOptionId ??
    avatarStyle;
  const background =
    matchedOption?.background ??
    lookupGeneratedBackground(input.avatarOptionId) ??
    null;
  return { url: buildAgentAvatarDataUri(avatarStyle, seed), background };
}

function lookupGeneratedBackground(id: string): string | null {
  const GENERATED_PALETTE = [
    { background: "#d7ecf8" },
    { background: "#e1e2f0" },
    { background: "#ffe1c7" },
    { background: "#cceaf5" },
    { background: "#ddefc8" },
  ];
  const match = GENERATED_AVATAR_ID_RE.exec(id);
  if (!match) return null;
  const page = Number.parseInt(match[2]!, 10);
  const index = Number.parseInt(match[3]!, 10);
  if (Number.isNaN(page) || Number.isNaN(index)) return null;
  const AVATARS_PER_STYLE = 5;
  const palette =
    GENERATED_PALETTE[
      (page * AVATARS_PER_STYLE + index) % GENERATED_PALETTE.length
    ];
  return palette?.background ?? null;
}

function lookupGeneratedSeed(id: string): string | null {
  const match = GENERATED_AVATAR_ID_RE.exec(id);
  if (!match) return null;
  const style = normalizeAgentAvatarStyle(match[1]) ?? match[1];
  const page = Number.parseInt(match[2]!, 10);
  const index = Number.parseInt(match[3]!, 10);
  if (Number.isNaN(page) || Number.isNaN(index)) return null;
  const AVATARS_PER_STYLE = 5;
  return `${style}-${page * AVATARS_PER_STYLE + index + 1}`;
}

const AUTO_PROVIDER_IDS = new Set(["auto", "\u81EA\u52A8"]);

export function isValidSdkModelRef(
  providerID: string | undefined,
  modelID: string | undefined,
): providerID is string {
  if (!providerID || !modelID) return false;
  if (AUTO_PROVIDER_IDS.has(providerID)) return false;
  if (modelID.toLowerCase() === "auto") return false;
  return true;
}

export function friendlyModelNameToModelRef(
  provider: AgentModelProvider,
  model: string,
): { providerID: string; modelID: string } | null {
  if (AUTO_PROVIDER_IDS.has(provider) || model === "Auto") {
    return null;
  }

  const providerMap: Record<string, string> = {
    auto: "auto",
    "\u81EA\u52A8": "auto",
    Gemini: "google",
    OpenAI: "openai",
    Claude: "anthropic",
  };

  const providerID = providerMap[provider];
  if (!providerID) return null;

  const modelNameMap: Record<string, string> = {
    "Gemini 3 Flash": "gemini-2.5-flash",
    "Gemini 1.5 Pro": "gemini-1.5-pro",
    "Gemini 2.5 Pro": "gemini-2.5-pro",
    "GPT-4.1": "gpt-4.1",
    "GPT-4o": "gpt-4o",
    o3: "o3",
    "Claude Sonnet 4": "claude-sonnet-4",
    "Claude 3.7 Sonnet": "claude-3.7-sonnet",
    "Claude 3.5 Haiku": "claude-3.5-haiku",
  };

  const modelID = modelNameMap[model];
  if (!modelID) return null;

  return { providerID, modelID };
}
