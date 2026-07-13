import assert from "node:assert/strict";
import test from "node:test";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

import { createBrowserUseOpenCodeModelInvoker } from "./opencode-model-invoker.mjs";

test("invokes the selected desktop model with JSON schema and no tools", async () => {
  const calls = [];
  const session = {
      async create(input) {
        calls.push({ method: "create", input });
        return { data: { id: "model-session" } };
      },
      async prompt(input) {
        calls.push({ method: "prompt", input });
        return {
          data: {
            info: {
              structured: { action: "click" },
              tokens: { input: 11, output: 4 },
            },
            parts: [],
          },
        };
      },
      async delete(input) {
        calls.push({ method: "delete", input });
      },
  };
  const baseClient = createOpencodeClient({ baseUrl: "http://127.0.0.1:1" });
  const client = new Proxy(baseClient, {
    get(target, property, receiver) {
      return property === "session" ? session : Reflect.get(target, property, receiver);
    },
  });
  const invoke = createBrowserUseOpenCodeModelInvoker({
    createClient: () => client,
    connectionInfo: async () => ({ baseUrl: "http://127.0.0.1:4096", directory: "/tmp/work" }),
  });
  const result = await invoke({
    ownerId: "conversation:a",
    model: { providerID: "openai", modelID: "gpt-5" },
    messages: [
      { role: "system", content: "You control a browser." },
      { role: "user", content: "Inspect the page" },
    ],
    outputSchema: { type: "object", properties: { action: { type: "string" } } },
  });

  const prompt = calls.find((call) => call.method === "prompt").input;
  assert.deepEqual(prompt.model, { providerID: "openai", modelID: "gpt-5" });
  assert.deepEqual(prompt.tools, {});
  assert.equal(prompt.format.type, "json_schema");
  assert.match(prompt.system, /control a browser/i);
  assert.match(prompt.parts[0].text, /Inspect the page/);
  assert.deepEqual(result, {
    value: { action: "click" },
    usage: { inputTokens: 11, outputTokens: 4 },
  });
  assert.equal(calls.at(-1).method, "delete");
});

test("parses JSON from text when a selected model omits OpenCode structured output", async () => {
  const session = {
    async create() {
      return { data: { id: "model-session" } };
    },
    async prompt() {
      return {
        data: {
          info: { tokens: { input: 7, output: 3 } },
          parts: [{ type: "text", text: "```json\n{\"action\":\"click\"}\n```" }],
        },
      };
    },
    async delete() {},
  };
  const baseClient = createOpencodeClient({ baseUrl: "http://127.0.0.1:1" });
  const client = new Proxy(baseClient, {
    get(target, property, receiver) {
      return property === "session" ? session : Reflect.get(target, property, receiver);
    },
  });
  const invoke = createBrowserUseOpenCodeModelInvoker({
    createClient: () => client,
    connectionInfo: async () => ({ baseUrl: "http://127.0.0.1:4096" }),
  });

  const result = await invoke({
    ownerId: "conversation:a",
    model: { providerID: "moonshotai", modelID: "kimi-k2.6" },
    messages: [{ role: "user", content: "Inspect the page" }],
    outputSchema: { type: "object", properties: { action: { type: "string" } } },
  });

  assert.deepEqual(result.value, { action: "click" });
});

test("retries in text mode when OpenCode returns neither structured output nor text", async () => {
  const prompts = [];
  const session = {
    async create() {
      return { data: { id: "model-session" } };
    },
    async prompt(input) {
      prompts.push(input);
      if (prompts.length === 1) {
        return { data: { info: {}, parts: [] } };
      }
      return {
        data: {
          info: { tokens: { input: 9, output: 5 } },
          parts: [{ type: "text", text: '{"action":"done"}' }],
        },
      };
    },
    async delete() {},
  };
  const baseClient = createOpencodeClient({ baseUrl: "http://127.0.0.1:1" });
  const client = new Proxy(baseClient, {
    get(target, property, receiver) {
      return property === "session" ? session : Reflect.get(target, property, receiver);
    },
  });
  const invoke = createBrowserUseOpenCodeModelInvoker({
    createClient: () => client,
    connectionInfo: async () => ({ baseUrl: "http://127.0.0.1:4096" }),
  });

  const result = await invoke({
    ownerId: "conversation:a",
    model: { providerID: "moonshotai", modelID: "kimi-k2.6" },
    messages: [{ role: "user", content: "Inspect the page" }],
    outputSchema: { type: "object", properties: { action: { type: "string" } } },
  });

  assert.equal(prompts.length, 2);
  assert.equal(prompts[1].format.type, "text");
  assert.match(prompts[1].parts[0].text, /JSON Schema/);
  assert.deepEqual(result.value, { action: "done" });
});
