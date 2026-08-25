import { describe, expect, test } from "bun:test";
import { readJsonBody } from "../src/core/request-body.js";
import { AGENT_RUNTIME_PROMPT_HTTP_BODY_MAX_BYTES } from "../src/services/agent-runtime-prompt-parts.js";

describe("readJsonBody", () => {
  test("rejects bodies over the declared byte cap before JSON parse completes as a model request", async () => {
    const oversize = "x".repeat(AGENT_RUNTIME_PROMPT_HTTP_BODY_MAX_BYTES + 8);
    const request = new Request("http://server.test/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: oversize }),
    });
    await expect(readJsonBody(request, {
      maxBytes: AGENT_RUNTIME_PROMPT_HTTP_BODY_MAX_BYTES,
    })).rejects.toMatchObject({ code: "payload_too_large" });
  });

  test("accepts an in-limit prompt body", async () => {
    const request = new Request("http://server.test/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    await expect(readJsonBody(request, {
      maxBytes: AGENT_RUNTIME_PROMPT_HTTP_BODY_MAX_BYTES,
    })).resolves.toEqual({ text: "hello" });
  });
});
