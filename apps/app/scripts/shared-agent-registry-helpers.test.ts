import { describe, expect, test } from "bun:test";

import {
  friendlyModelNameToModelRef,
  isValidSdkModelRef,
  resolveAgentAvatarUrl,
} from "../src/react-app/domains/shared/agent-registry-helpers";
import type { AgentRegistry } from "../src/react-app/domains/shared/agent-registry-types";

const registry = {
  version: 1,
  updatedAt: "2026-06-24T00:00:00.000Z",
  avatars: [
    {
      id: "robot-helper",
      style: "机器人",
      label: "Helper",
      initials: "H",
      background: "#d9eefc",
      foreground: "#174767",
      accent: "#4a94d2",
    },
  ],
  templates: [],
  agents: [],
  skills: [],
} satisfies AgentRegistry;

describe("shared agent registry helpers", () => {
  test("resolves custom and generated avatar payloads", () => {
    expect(
      resolveAgentAvatarUrl({
        avatarStyle: "机器人",
        avatarOptionId: "robot-helper",
        customAvatarDataUrl: "data:image/png;base64,custom",
      }, registry),
    ).toEqual({ url: "data:image/png;base64,custom", background: null });

    const generated = resolveAgentAvatarUrl({
      avatarStyle: "机器人",
      avatarOptionId: "robot-helper",
      customAvatarDataUrl: null,
    }, registry);

    expect(generated.url).toStartWith("data:image/svg+xml");
    expect(generated.background).toBe("#d9eefc");
  });

  test("maps friendly provider/model names to SDK model refs", () => {
    expect(friendlyModelNameToModelRef("OpenAI", "GPT-4.1")).toEqual({
      providerID: "openai",
      modelID: "gpt-4.1",
    });
    expect(friendlyModelNameToModelRef("自动", "Auto")).toBeNull();
    expect(friendlyModelNameToModelRef("Unknown", "GPT-4.1")).toBeNull();
  });

  test("rejects wizard auto placeholders as SDK model refs", () => {
    expect(isValidSdkModelRef("openai", "gpt-4.1")).toBe(true);
    expect(isValidSdkModelRef("自动", "gpt-4.1")).toBe(false);
    expect(isValidSdkModelRef("openai", "Auto")).toBe(false);
    expect(isValidSdkModelRef(undefined, "gpt-4.1")).toBe(false);
  });
});
