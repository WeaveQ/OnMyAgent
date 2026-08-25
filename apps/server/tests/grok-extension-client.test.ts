import { describe, expect, test } from "bun:test";
import { ApiError } from "../src/core/errors.js";
import { GrokExtensionClient, isMethodMissing } from "../src/services/grok-extension-client.js";
import { decodeGrokCommandEnvelope } from "../src/services/grok-runtime-adapter.js";
import { assertSafeGrokExpertProfile, closeGrokToolDependencies } from "../src/services/grok-expert-profile-guard.js";
import { compileMinimalGrokExpertProfile } from "../src/services/grok-expert-profile-compiler.js";
import { listGrokNativeMcpInventory } from "../src/services/grok-native-mcp-inventory.js";

describe("GrokExtensionClient", () => {
  test("does not treat generic remote failures as method-missing", () => {
    expect(isMethodMissing(new ApiError(
      502,
      "grok_acp_remote_error",
      "Grok ACP x.ai/commands/list failed",
    ))).toBe(false);
    expect(isMethodMissing(new ApiError(
      400,
      "grok_acp_remote_error",
      "invalid params failed",
      { jsonRpcCode: -32602 },
    ))).toBe(false);
    expect(isMethodMissing(new ApiError(
      502,
      "grok_acp_remote_error",
      "Grok ACP x.ai/session/info failed",
      { jsonRpcCode: -32601 },
    ))).toBe(true);
    expect(isMethodMissing(new ApiError(
      502,
      "grok_acp_remote_error",
      "upstream said method not found in a wrapped payload",
    ))).toBe(false);
    expect(isMethodMissing(new ApiError(
      502,
      "grok_acp_remote_error",
      "unknown method in diagnostic text",
      { jsonRpcCode: -32602 },
    ))).toBe(false);
  });

  test("read methods degrade only a precise unknown-method signal", async () => {
    const client = new GrokExtensionClient({
      async request() {
        throw new ApiError(
          502,
          "grok_acp_remote_error",
          "Grok ACP x.ai/commands/list failed",
          { jsonRpcCode: -32601 },
        );
      },
    });
    await expect(client.call("commands", {}, () => [])).resolves.toMatchObject({
      ok: false,
      complete: false,
      unavailable: true,
      code: "grok_acp_remote_error",
    });
  });

  test("read methods throw invalid-params and runtime failures", async () => {
    const client = new GrokExtensionClient({
      async request() {
        throw new ApiError(
          502,
          "grok_acp_remote_error",
          "Grok ACP x.ai/commands/list failed",
          { jsonRpcCode: -32602 },
        );
      },
    });
    await expect(client.call("commands", {}, () => [])).rejects.toMatchObject({
      code: "grok_acp_remote_error",
    });
  });

  test("read methods degrade when every alias is missing", async () => {
    const client = new GrokExtensionClient({
      async request() {
        throw new ApiError(409, "agent_runtime_capability_unsupported", "Method not found");
      },
    });
    await expect(client.call("commands", {}, () => [])).resolves.toMatchObject({
      ok: false,
      complete: false,
      unavailable: true,
    });
  });

  test("write methods fail closed when missing", async () => {
    const client = new GrokExtensionClient({
      async request() {
        throw new ApiError(409, "agent_runtime_capability_unsupported", "Method not found");
      },
    });
    await expect(client.call("session.rename", {}, () => undefined))
      .rejects.toMatchObject({ code: "agent_runtime_capability_unsupported" });
  });
});

describe("Grok command envelopes", () => {
  test("accepts a bare array and argumentHint aliases", () => {
    expect(decodeGrokCommandEnvelope([
      { name: "compact", argumentHint: "keep auth" },
      { name: "review", argument_hint: "files" },
      { name: "always-approve" },
    ])).toEqual({
      complete: true,
      items: [
        { id: "grok:command:compact", name: "compact", inputHint: "keep auth", source: "command" },
        { id: "grok:command:review", name: "review", inputHint: "files", source: "command" },
      ],
    });
  });
});

describe("Grok Expert profile guard", () => {
  test("closes tool dependencies and rejects hooks or missing toolConfig", () => {
    expect(closeGrokToolDependencies(["GrokBuild:run_terminal_cmd"])).toEqual([
      "GrokBuild:get_task_output",
      "GrokBuild:kill_task",
      "GrokBuild:run_terminal_cmd",
    ]);
    expect(() => assertSafeGrokExpertProfile({
      injectDefaultTools: false,
      inheritSkills: false,
      discoverSkills: false,
      mcpInheritance: "none",
      permissionMode: "default",
      agentsMd: false,
      hooks: [],
      toolConfig: { tools: [] },
    })).toThrow(expect.objectContaining({ code: "grok_expert_profile_field_forbidden" }));
    const compiled = compileMinimalGrokExpertProfile({
      expertId: "kol-content-ops-specialist",
      description: "ops",
      systemPrompt: "Stay in role.",
      declaredSkillNames: [],
      allowedBuiltInToolIds: ["GrokBuild:run_terminal_cmd"],
    });
    expect(compiled.agentProfile.injectDefaultTools).toBe(false);
    expect(Array.isArray(compiled.agentProfile.toolConfig.tools)).toBe(true);
    expect(compiled.agentProfile.toolConfig.tools.map((tool) => tool.id)).toEqual([
      "GrokBuild:get_task_output",
      "GrokBuild:kill_task",
      "GrokBuild:run_terminal_cmd",
    ]);
  });
});

describe("Grok native MCP inventory", () => {
  test("is read-only and never claims ACP stdio tool injection", async () => {
    const inventory = await listGrokNativeMcpInventory({
      async request() {
        return { servers: [{ name: "filesystem" }] };
      },
    });
    expect(inventory).toEqual({
      source: "runtime-native",
      items: [{ name: "filesystem", status: "unknown" }],
      complete: true,
      toolInjectionVerified: false,
    });
  });
});
