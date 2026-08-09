import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { setLocale } from "../src/i18n";
import { MessageTips } from "../src/react-app/domains/local-agents/messages/message-tips";

const repoRoot = join(import.meta.dir, "../../..");

describe("local agent empty ACP error UX", () => {
  test("shows context-window guidance before generic session prompt guidance", () => {
    setLocale("en");
    const message: Parameters<typeof MessageTips>[0]["message"] = {
      id: "context-window-error",
      type: "tips",
      role: "system",
      text: "session/prompt: maximum context length exceeded",
      createdAt: 1,
      category: "error",
      ownership: "agent",
      resolution: null,
    };
    const html = renderToStaticMarkup(createElement(MessageTips, { message }));
    expect(html).toContain("This conversation exceeded the model context window");
    expect(html).not.toContain("This turn failed while the agent handled the request");
  });

  test("localizes a provider-session context reset warning", () => {
    setLocale("en");
    const message: Parameters<typeof MessageTips>[0]["message"] = {
      id: "context-reset-warning",
      type: "tips",
      role: "system",
      text: "codex started a clean provider session; earlier conversation context was not replayed.",
      createdAt: 1,
      category: "warning",
      ownership: "agent",
      resolution: null,
    };
    const html = renderToStaticMarkup(createElement(MessageTips, { message }));
    expect(html).toContain("The provider session was reset");
    expect(html).not.toContain("codex started a clean provider session");
  });

  test("classifies empty assistant text and de-dupes timeline + footer", () => {
    const diagnostics = readFileSync(
      join(
        repoRoot,
        "apps/desktop/electron/personal-agent-runtime/error-diagnostics.mjs",
      ),
      "utf8",
    );
    const acp = readFileSync(
      join(
        repoRoot,
        "apps/desktop/electron/personal-agent-runtime/adapters/acp-generic.mjs",
      ),
      "utf8",
    );
    const messageUtils = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/local-agents/messages/message-utils.ts",
      ),
      "utf8",
    );
    const timeline = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/local-agents/messages/timeline-messages.tsx",
      ),
      "utf8",
    );
    const bubble = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/local-agents/messages/chat-bubble.tsx",
      ),
      "utf8",
    );
    const zh = readFileSync(
      join(repoRoot, "apps/app/src/i18n/locales/zh/local_agent.ts"),
      "utf8",
    );

    expect(diagnostics).toContain("without assistant");
    expect(diagnostics).toContain('code = "empty_output"');
    expect(diagnostics).toContain('code === "empty_output" || code === "acp_incomplete_output"');
    expect(diagnostics).toContain('ownership = "agent"');
    expect(acp).toContain('"empty_output"');
    expect(acp).toContain("returned assistant text only in the prompt result");
    expect(messageUtils).toContain('code === "empty_output"');
    expect(messageUtils).toContain("failure_empty_output");
    expect(messageUtils).toContain("failure_acp_prompt");
    expect(messageUtils).toContain("runTimelineAlreadyShowsFailure");
    expect(diagnostics).toContain('code = "acp_prompt_failed"');
    expect(diagnostics).toContain('code: "context_window_exceeded"');
    expect(diagnostics).toContain("session/prompt");
    expect(timeline).toContain("sanitizeAssistantTranscriptText");
    expect(bubble).toContain("runTimelineAlreadyShowsFailure");
    expect(bubble).toContain("sanitizeAssistantTranscriptText");
    expect(zh).toContain("local_agent.failure_empty_output");
    expect(zh).toContain("local_agent.failure_acp_prompt");

    const helpers = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/local-agents/host/personal-local-agent-page-helpers.ts",
      ),
      "utf8",
    );
    const tips = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/local-agents/messages/message-tips.tsx",
      ),
      "utf8",
    );
    // Failed runs clear body when timeline already shows the error card.
    expect(helpers).toContain("runTimelineAlreadyShowsFailure(run)");
    expect(helpers).toMatch(/status === "failed"[\s\S]{0,200}return ""/);
    expect(helpers).toContain("sanitizeAssistantTranscriptText");
    // Client re-maps empty-output / session-prompt tips to Agent ownership (not 服务).
    expect(tips).toContain("isEmptyAssistantFailure");
    expect(tips).toContain("isAcpPromptFailure");
    expect(tips).toContain("isIncompleteAcpReply");
    expect(tips).toContain("isContextWindowFailure");
    expect(tips).toContain('? "agent"');
  });
});
