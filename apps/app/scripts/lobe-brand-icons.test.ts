import { describe, expect, test } from "bun:test";

import {
  lobeStaticSvgUrl,
  resolveLobeAgentIconId,
  resolveLobePluginIconId,
  resolveLobeProviderKey,
} from "../src/react-app/design-system/lobe-provider-key";

describe("resolveLobeProviderKey", () => {
  test("maps common provider ids", () => {
    expect(resolveLobeProviderKey("openai")).toBe("openai");
    expect(resolveLobeProviderKey("anthropic")).toBe("anthropic");
    expect(resolveLobeProviderKey("deepseek")).toBe("deepseek");
    expect(resolveLobeProviderKey("openrouter")).toBe("openrouter");
    expect(resolveLobeProviderKey("ollama")).toBe("ollama");
    expect(resolveLobeProviderKey("google")).toBe("google");
    expect(resolveLobeProviderKey("xai")).toBe("xai");
    expect(resolveLobeProviderKey("opencode")).toBe("opencode");
  });

  test("maps via display name when id is opaque", () => {
    expect(resolveLobeProviderKey("uuid-abc", "Anthropic Claude")).toBe("anthropic");
    expect(resolveLobeProviderKey("cloud-1", "OpenAI GPT-4o")).toBe("openai");
    expect(resolveLobeProviderKey(null, "DeepSeek Chat")).toBe("deepseek");
  });

  test("returns null for unknown providers", () => {
    expect(resolveLobeProviderKey("totally-unknown-xyz")).toBeNull();
    expect(resolveLobeProviderKey(null, null)).toBeNull();
  });
});

describe("agent / plugin lobe ids", () => {
  test("maps product agents", () => {
    expect(resolveLobeAgentIconId("claude")).toBe("claude");
    expect(resolveLobeAgentIconId("codex")).toBe("openai");
    expect(resolveLobeAgentIconId("hermes")).toBe("hermesagent");
    expect(resolveLobeAgentIconId("openclaw")).toBe("openclaw");
    expect(resolveLobeAgentIconId("opencode")).toBe("opencode");
    expect(resolveLobeAgentIconId("mimo")).toBe("xiaomimimo");
    expect(resolveLobeAgentIconId("onmyagent")).toBeNull();
    expect(resolveLobeAgentIconId("cursor-agent")).toBeNull();
  });

  test("maps plugin preview keys", () => {
    expect(resolveLobePluginIconId("github")).toBe("github");
    expect(resolveLobePluginIconId("notion")).toBe("notion");
    expect(resolveLobePluginIconId("m365")).toBe("microsoft");
    expect(resolveLobePluginIconId("wordpress")).toBeNull();
  });

  test("builds static svg urls on aliyun npmmirror", () => {
    // openai has mono only on static-svg — color request falls back to mono
    const openai = lobeStaticSvgUrl("openai", "color");
    expect(openai).toContain("registry.npmmirror.com");
    expect(openai).toContain("icons-static-svg");
    expect(openai).toContain("/openai.svg");
    expect(openai).not.toContain("openai-color");
    expect(openai).not.toContain("unpkg.com");

    // claude ships color
    const claude = lobeStaticSvgUrl("claude", "color");
    expect(claude).toContain("claude-color.svg");

    const mono = lobeStaticSvgUrl("openai", "mono");
    expect(mono).toContain("/openai.svg");
  });
});
