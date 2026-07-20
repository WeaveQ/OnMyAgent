import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("local agent empty ACP error UX", () => {
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
    expect(tips).toContain('? "agent"');
  });
});
