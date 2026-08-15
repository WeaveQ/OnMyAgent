import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";

import {
  addOptimisticSessionUserMessage,
  adoptEquivalentOptimisticUserTextPart,
  dropEquivalentOptimisticUserMessages,
  removeOptimisticSessionUserMessage,
} from "../src/react-app/domains/session/sync/optimistic-session-user-message";

function message(id: string, role: "user" | "assistant", text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text, state: "done" }],
  };
}

describe("optimistic session user messages", () => {
  it("shows the first user prompt immediately", () => {
    const next = addOptimisticSessionUserMessage([], {
      messageId: "msg_first",
      text: "first prompt",
      createdAt: 42,
    });

    expect(next).toEqual([
      {
        id: "msg_first",
        role: "user",
        metadata: { opencode: { created: 42 } },
        parts: [{ type: "text", text: "first prompt", state: "done" }],
      },
    ]);
  });

  it("does not duplicate a message already delivered by the runtime", () => {
    const current = [message("msg_first", "user", "server prompt")];

    expect(
      addOptimisticSessionUserMessage(current, {
        messageId: "msg_first",
        text: "first prompt",
        createdAt: 42,
      }),
    ).toBe(current);
  });

  it("lets a canonical skill text part replace its equivalent optimistic placeholder", () => {
    const text = "[[skill:getworkbuddy]] 召唤专家团 腾讯云技术支持";
    const optimistic = addOptimisticSessionUserMessage([], {
      messageId: "msg_skill",
      text,
      createdAt: 42,
    })[0]!;
    const canonicalPart: UIMessage["parts"][number] = {
      type: "text",
      text,
      state: "done",
      providerMetadata: { opencode: { partId: "prt_skill" } },
    };

    expect(adoptEquivalentOptimisticUserTextPart(optimistic, canonicalPart))
      .toEqual({ ...optimistic, parts: [canonicalPart] });
  });

  it("does not collapse distinct user text parts", () => {
    const optimistic = message("msg_user", "user", "first prompt");
    const canonicalPart: UIMessage["parts"][number] = {
      type: "text",
      text: "second prompt",
      state: "done",
      providerMetadata: { opencode: { partId: "prt_second" } },
    };

    expect(adoptEquivalentOptimisticUserTextPart(optimistic, canonicalPart))
      .toBeNull();
  });

  it("removes only the failed optimistic prompt", () => {
    const assistant = message("msg_assistant", "assistant", "answer");
    const current = [message("msg_first", "user", "first prompt"), assistant];

    expect(removeOptimisticSessionUserMessage(current, "msg_first")).toEqual([
      assistant,
    ]);
  });

  it("drops a slash-chip optimistic bubble when the [[skill:]] turn arrives", () => {
    const optimistic = addOptimisticSessionUserMessage([], {
      messageId: "msg_ea401b16-9af4-457a-bf76-51e30893740a",
      text: "/skill-creator 请帮我创建一个可以实现电脑截图的skill",
      createdAt: 42,
    });
    const canonical: UIMessage = {
      id: "msg_000cdadf2001pKTHcqf88pAK4z",
      role: "user",
      parts: [
        {
          type: "text",
          text: "[[skill:skill-creator]] 请帮我创建一个可以实现电脑截图的skill",
          state: "done",
          providerMetadata: { opencode: { partId: "prt_user" } },
        },
      ],
    };

    expect(
      dropEquivalentOptimisticUserMessages([...optimistic, canonical], canonical),
    ).toEqual([canonical]);
  });

  it("drops a local UUID bubble when the canonical user turn arrives", () => {
    const optimistic = addOptimisticSessionUserMessage([], {
      messageId: "msg_ea401b16-9af4-457a-bf76-51e30893740a",
      text: "你能做什么",
      createdAt: 42,
    });
    const canonical: UIMessage = {
      id: "msg_000cdadf2001pKTHcqf88pAK4z",
      role: "user",
      parts: [
        {
          type: "text",
          text: "你能做什么",
          state: "done",
          providerMetadata: { opencode: { partId: "prt_user" } },
        },
      ],
    };

    expect(
      dropEquivalentOptimisticUserMessages([...optimistic, canonical], canonical),
    ).toEqual([canonical]);
  });
});
