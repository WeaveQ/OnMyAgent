import { beforeEach, describe, expect, test } from "bun:test";

import {
  buildHomePromptEnhanceUserMessage,
  clearPromptEnhanceScratchSessionsForTests,
  compactPromptEnhanceTurns,
  enhancePromptWithScratchSession,
  isPromptEnhanceScratchSession,
  isPromptEnhanceScratchSessionId,
  listPromptEnhanceScratchSessions,
  PROMPT_ENHANCE_SESSION_TITLE,
  PROMPT_ENHANCE_SYSTEM,
  registerPromptEnhanceScratchSession,
  shouldIgnorePromptEnhanceScratchEvent,
  unregisterPromptEnhanceScratchSession,
  unwrapEnhancedPromptText,
  DISABLED_TOOLS,
} from "../src/app/lib/opencode-enhance-prompt";
import type { Client, ModelRef } from "../src/app/types";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const model: ModelRef = { providerID: "openai", modelID: "gpt-4.1" };

function ok<T>(data: T) {
  return { data, request: new Request("http://local"), response: new Response() };
}

describe("opencode home prompt enhance scratch session", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });

  beforeEach(() => {
    clearPromptEnhanceScratchSessionsForTests();
  });

  test("packs compact home context and unwraps fenced model output", () => {
    const user = buildHomePromptEnhanceUserMessage({
      draft: "帮我写周报",
      attachmentNames: ["notes.md"],
      workspaceFolderName: "office",
      mentionNames: ["agenda"],
    });
    expect(user).toContain("帮我写周报");
    expect(user).toContain("notes.md");
    expect(user).not.toContain("Current draft");
    expect(user).not.toContain("Selected workspace folder");
    expect(user).not.toContain("office");
    expect(user).toContain("@agenda");
    expect(PROMPT_ENHANCE_SYSTEM).toContain("50");
    expect(PROMPT_ENHANCE_SYSTEM).toContain("100");
    expect(PROMPT_ENHANCE_SYSTEM).not.toContain("Add a goal, constraints");
    expect(PROMPT_ENHANCE_SYSTEM).toContain("Return ONLY the rewritten prompt");
    const packed = buildHomePromptEnhanceUserMessage({
      draft: "继续",
      recentTurns: [{ role: "user", text: "先写大纲" }, { role: "assistant", text: "好的" }],
    });
    expect(packed).toContain("继续");
    expect(packed).toContain("They previously asked: 先写大纲");
    expect(packed).toContain("The assistant previously replied: 好的");
    expect(packed).not.toContain("Recent conversation:");
    expect(packed).not.toContain("User:");
    expect(packed).not.toContain("Assistant:");
    expect(PROMPT_ENHANCE_SYSTEM).toContain("Never output a transcript");
    expect(compactPromptEnhanceTurns([
      { role: "system", parts: [{ type: "text", text: "ignore" }] },
      { role: "user", parts: [{ type: "text", text: "one" }] },
      { role: "assistant", parts: [{ type: "text", text: "two" }] },
      { role: "user", parts: [{ type: "text", text: "three" }] },
      { role: "assistant", parts: [{ type: "text", text: "four" }] },
      { role: "user", parts: [{ type: "text", text: "five" }] },
    ]).map((turn) => turn.text)).toEqual(["two", "three", "four", "five"]);
    expect(unwrapEnhancedPromptText("```\nImproved weekly report prompt\n```")).toBe(
      "Improved weekly report prompt",
    );
    expect(
      unwrapEnhancedPromptText(
        "Current draft:\n你好啊\n\nSelected workspace folder:\nomg_1\n你好啊。\n\n目标：问好。",
      ),
    ).toBe("你好啊。\n\n目标：问好。");
    expect(
      unwrapEnhancedPromptText(
        [
          "Recent conversation:",
          "User: 你是什么模型",
          "Assistant: 我是 ark-code-latest (模型 ID: huoshan-1/ark-code-latest)，运行在 OnMyAgent 里。",
          "你觉得你自己作为 ark-code-latest 这个模型怎么样？有什么擅长和不擅长的地方？",
        ].join("\n"),
      ),
    ).toBe("你觉得你自己作为 ark-code-latest 这个模型怎么样？有什么擅长和不擅长的地方？");
    expect(unwrapEnhancedPromptText("User: please review the attached brief")).toBe(
      "User: please review the attached brief",
    );
  });

  test("registers scratch ids so failed deletes stay hidden from lists", () => {
    registerPromptEnhanceScratchSession("ses_enhance_1");
    expect(isPromptEnhanceScratchSessionId("ses_enhance_1")).toBe(true);
    expect(
      isPromptEnhanceScratchSession({
        id: "ses_other",
        title: PROMPT_ENHANCE_SESSION_TITLE,
      }),
    ).toBe(true);
    expect(isPromptEnhanceScratchSession({ id: "ses_ok", title: "Weekly report" })).toBe(false);
    unregisterPromptEnhanceScratchSession("ses_enhance_1");
    expect(listPromptEnhanceScratchSessions()).not.toContain("ses_enhance_1");
    registerPromptEnhanceScratchSession("ses_stream");
    expect(
      shouldIgnorePromptEnhanceScratchEvent({
        type: "message.part.updated",
        properties: { part: { sessionID: "ses_stream", type: "text", text: "x" } },
      }),
    ).toBe(true);
    expect(
      shouldIgnorePromptEnhanceScratchEvent({
        type: "session.idle",
        properties: { sessionID: "ses_home" },
      }),
    ).toBe(false);
  });

  test("creates a titled scratch session, prompts the selected model with no tools, then deletes", async () => {
    const calls: string[] = [];
    const idle = {
      type: "session.idle",
      properties: { sessionID: "ses_scratch" },
    };
    async function* stream() {
      yield {
        type: "message.part.updated",
        properties: {
          part: {
            id: "prt_1",
            sessionID: "ses_scratch",
            type: "text",
            text: "Write a weekly report with goals and risks.",
          },
        },
      };
      yield idle;
    }
    const client = {
      session: {
        create: async (input: { title?: string }) => {
          calls.push(`create:${input.title}`);
          return ok({ id: "ses_scratch" });
        },
        promptAsync: async (input: {
          sessionID: string;
          model?: ModelRef;
          tools?: Record<string, boolean>;
          system?: string;
        }) => {
          calls.push(`prompt:${input.sessionID}:${input.model?.modelID}`);
          expect(input.tools?.bash).toBe(false);
          expect(input.tools?.skill).toBe(false);
          expect(input.tools?.mcp).toBe(false);
          expect(input.tools?.browser).toBe(false);
          expect(input.tools?.read).toBe(false);
          expect(input.system).toBe(PROMPT_ENHANCE_SYSTEM);
          return ok({});
        },
        messages: async () => ok([]),
        delete: async (input: { sessionID: string }) => {
          calls.push(`delete:${input.sessionID}`);
          return ok({});
        },
        abort: async () => ok({}),
      },
      event: {
        subscribe: async () => ({ stream: stream() }),
      },
    } as unknown as Client;

    const text = await enhancePromptWithScratchSession({
      client,
      directory: "/tmp/ws",
      model,
      draft: "写周报",
    });
    expect(text).toBe("Write a weekly report with goals and risks.");
    expect(calls).toEqual([
      `create:${PROMPT_ENHANCE_SESSION_TITLE}`,
      "prompt:ses_scratch:gpt-4.1",
      "delete:ses_scratch",
    ]);
    expect(isPromptEnhanceScratchSessionId("ses_scratch")).toBe(false);
  });

  test("keeps a failed delete registered so the rail can still hide it", async () => {
    async function* stream() {
      yield { type: "session.idle", properties: { sessionID: "ses_ghost" } };
    }
    const client = {
      session: {
        create: async () => ok({ id: "ses_ghost" }),
        promptAsync: async () => ok({}),
        messages: async () =>
          ok([
            {
              info: { role: "assistant" },
              parts: [{ type: "text", text: "Improved prompt" }],
            },
          ]),
        delete: async () => {
          throw new Error("offline");
        },
        abort: async () => ok({}),
      },
      event: {
        subscribe: async () => ({ stream: stream() }),
      },
    } as unknown as Client;

    await enhancePromptWithScratchSession({
      client,
      model,
      draft: "写周报",
    });
    expect(isPromptEnhanceScratchSessionId("ses_ghost")).toBe(true);
  });

  test("timeout keeps already-streamed assistant text", async () => {
    const client = {
      session: {
        create: async () => ok({ id: "ses_timeout" }),
        promptAsync: async () => ok({}),
        messages: async () => ok([]),
        delete: async () => ok({}),
        abort: async () => ok({}),
      },
      event: {
        subscribe: async (_params: undefined, options?: { signal?: AbortSignal }) => {
          const signal = options?.signal;
          async function* abortable() {
            yield {
              type: "message.part.updated",
              properties: {
                part: {
                  id: "prt_1",
                  sessionID: "ses_timeout",
                  type: "text",
                  text: "Keep this streamed prompt.",
                },
              },
            };
            await new Promise((_, reject) => {
              const fail = () => reject(new DOMException("Aborted", "AbortError"));
              if (signal?.aborted) {
                fail();
                return;
              }
              signal?.addEventListener("abort", fail, { once: true });
            });
          }
          return { stream: abortable() };
        },
      },
    } as unknown as Client;

    const text = await enhancePromptWithScratchSession({
      client,
      model,
      draft: "写周报",
      timeoutMs: 20,
    });
    expect(text).toBe("Keep this streamed prompt.");
    expect(DISABLED_TOOLS.mcp).toBe(false);
  });
});
