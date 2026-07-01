import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractOpenClawPayloadText,
  isOpenClawFallbackSuccessLine,
  isPersonalAgentDiagnosticStderr,
  isPersonalAgentFatalStderr,
  isRecoverableCodexDiagnosticError,
  isRecoverableOpenClawFallbackLine,
} from "./personal-local-agent-runtime.mjs";

describe("personal local agent runtime diagnostics", () => {
  it("treats Codex plugin/git sync stderr as recoverable diagnostics", () => {
    const error = [
      "2026-06-10T08:22:26Z WARN codex_core_plugins::startup_sync: git sync failed for curated plugin sync",
      'fatal: early EOF git_binary="git"',
    ].join("\n");

    assert.equal(isPersonalAgentFatalStderr('fatal: early EOF git_binary="git"'), false);
    assert.equal(isPersonalAgentDiagnosticStderr('fatal: early EOF git_binary="git"'), true);
    assert.equal(isRecoverableCodexDiagnosticError(error), true);
  });

  it("keeps actual provider failures fatal", () => {
    assert.equal(isPersonalAgentFatalStderr("Model not found: token-plan/Qwen3.6 Plus"), true);
    assert.equal(isPersonalAgentFatalStderr("Invalid API-key provided"), true);
    assert.equal(isRecoverableCodexDiagnosticError("Invalid API-key provided"), false);
  });

  it("handles ANSI-wrapped local agent diagnostics without marking them fatal", () => {
    const line = "\u001b[31m[agent]\u001b[39m \u001b[33membedded run failover decision: reason=rate_limit\u001b[39m";

    assert.equal(isPersonalAgentDiagnosticStderr(line), true);
    assert.equal(isPersonalAgentFatalStderr(line), false);
  });

  it("treats OpenClaw provider quota during model fallback as recoverable", () => {
    assert.equal(isRecoverableOpenClawFallbackLine("⚠️ month allocated quota exceeded."), true);
    assert.equal(
      isRecoverableOpenClawFallbackLine(
        "[model-fallback] model fallback decision: decision=candidate_failed requested=bailian/qwen3.6-plus candidate=bailian/qwen3.6-plus reason=rate_limit next=dashscope/qwen3.6-plus detail=⚠️ month allocated quota exceeded.",
      ),
      true,
    );
    assert.equal(
      isOpenClawFallbackSuccessLine(
        "[model-fallback] model fallback decision: decision=candidate_succeeded requested=bailian/qwen3.6-plus candidate=dashscope/qwen3.6-plus reason=unknown next=none",
      ),
      true,
    );
  });

  it("extracts displayable text from OpenClaw JSON payloads", () => {
    const parsed = JSON.parse(`{
      "payloads": [
        {
          "text": "已记住 STUDIO-MEM-OPENCLAW-mqan63zr",
          "mediaUrl": null
        }
      ],
      "meta": { "provider": "dashscope", "model": "qwen3.6-plus" }
    }`);

    assert.equal(extractOpenClawPayloadText(parsed), "已记住 STUDIO-MEM-OPENCLAW-mqan63zr");
  });
});
