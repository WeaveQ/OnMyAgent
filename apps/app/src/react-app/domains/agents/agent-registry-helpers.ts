import { createAvatar } from "@dicebear/core";
import * as adventurer from "@dicebear/adventurer";
import * as bottts from "@dicebear/bottts";
import * as lorelei from "@dicebear/lorelei";
import * as pixelArt from "@dicebear/pixel-art";

import type { AgentAvatarStyle } from "./pending-agent-store";
import type { AgentModelProvider, AgentRegistry } from "./agent-registry-types";

export function buildAgentAvatarDataUri(
  style: AgentAvatarStyle,
  seed: string,
): string {
  const options = { seed, radius: 50 };
  switch (style) {
    case "像素风":
      return createAvatar(pixelArt, options).toDataUri();
    case "冒险家":
      return createAvatar(adventurer, options).toDataUri();
    case "机器人":
      return createAvatar(bottts, options).toDataUri();
    case "洛蕾莱":
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
  const matchedOption = registry?.avatars.find(
    (item) => item.id === input.avatarOptionId,
  );
  const seed =
    matchedOption?.label ??
    lookupGeneratedSeed(input.avatarOptionId) ??
    input.avatarOptionId ??
    input.avatarStyle;
  const background =
    matchedOption?.background ??
    lookupGeneratedBackground(input.avatarOptionId) ??
    null;
  return { url: buildAgentAvatarDataUri(input.avatarStyle, seed), background };
}

function lookupGeneratedBackground(id: string): string | null {
  const GENERATED_PALETTE = [
    { background: "#d7ecf8" },
    { background: "#e1e2f0" },
    { background: "#ffe1c7" },
    { background: "#cceaf5" },
    { background: "#ddefc8" },
  ];
  const match = /^generated:(像素风|冒险家|机器人|洛蕾莱):(\d+):(\d+)$/.exec(
    id,
  );
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
  const match = /^generated:(像素风|冒险家|机器人|洛蕾莱):(\d+):(\d+)$/.exec(
    id,
  );
  if (!match) return null;
  const style = match[1];
  const page = Number.parseInt(match[2]!, 10);
  const index = Number.parseInt(match[3]!, 10);
  if (Number.isNaN(page) || Number.isNaN(index)) return null;
  const AVATARS_PER_STYLE = 5;
  return `${style}-${page * AVATARS_PER_STYLE + index + 1}`;
}

export function isValidSdkModelRef(
  providerID: string | undefined,
  modelID: string | undefined,
): providerID is string {
  if (!providerID || !modelID) return false;
  if (providerID === "自动") return false;
  if (modelID.toLowerCase() === "auto") return false;
  return true;
}

export function friendlyModelNameToModelRef(
  provider: AgentModelProvider,
  model: string,
): { providerID: string; modelID: string } | null {
  if (provider === "自动" || model === "Auto") {
    return null;
  }

  const providerMap: Record<AgentModelProvider, string> = {
    自动: "auto",
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
