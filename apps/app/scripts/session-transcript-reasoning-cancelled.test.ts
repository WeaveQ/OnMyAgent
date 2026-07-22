import { describe, expect, test } from "bun:test";

const messageListSurfaceDir = new URL(
  "../src/react-app/domains/session/surface/",
  import.meta.url,
);
const messageListSourceFiles = [
  "message-list.tsx",
  "message-list/chrome.tsx",
  "message-list/reasoning.tsx",
  "message-list/dividers.ts",
  "message-list/step-row.tsx",
  "message-list/steps-container.tsx",
  "message-list/process-fold-ui.tsx",
  "message-list/turn-content.tsx",
] as const;

async function readMessageListSources() {
  const parts = await Promise.all(
    messageListSourceFiles.map((relativePath) =>
      Bun.file(new URL(relativePath, messageListSurfaceDir)).text(),
    ),
  );
  return parts.join("\n");
}

describe("session transcript WorkBuddy reasoning and cancellation states", () => {
  test("renders reasoning as a collapsed streaming-aware Markdown disclosure", async () => {
    const source = await readMessageListSources();

    expect(source).toContain("function TranscriptReasoning");
    expect(source).toContain("const [collapsed, setCollapsed] = useState(true)");
    expect(source).toContain('data-reasoning-state={props.complete ? "complete" : "streaming"}');
    expect(source).toContain('data-scrollable="true"');
    expect(source).toContain("max-h-[200px]");
    expect(source).toContain("<MessageRoleRow");
    expect(source).toContain('role="thinking"');
    expect(source).toContain("<MarkdownBlock");
    expect(source).toContain("streaming={!props.complete}");
    expect(source).toContain('t("session.reasoning")');
  });

  test("marks only the trailing active reasoning part as streaming", async () => {
    const source = await readMessageListSources();

    expect(source).toContain("isTrailingMessageContent");
    expect(source).toContain("isLastPartInGroup");
    expect(source).toContain("complete={!props.isStreamingReasoning}");
  });

  test("places the cancellation indicator after the final assistant content", async () => {
    const source = await readMessageListSources();

    expect(source).toContain('data-cancelled-indicator="true"');
    expect(source).toContain("function TranscriptCancelledIndicator");
    expect(source).toContain('props.presentation?.state !== "cancelled"');
    expect(source).toContain("!props.presentation.isActionBlock");
    expect(source).toContain('t("session.user_cancelled")');
    expect(source).toContain("function cancelledAssistantMessageIds");
    expect(source).toContain("cancelledMessageIds,");
  });

  test("keeps deterministic completed, streaming, and cancelled visual states", async () => {
    const fixture = await Bun.file(new URL(
      "./session-transcript-visual-fixture.tsx",
      import.meta.url,
    )).text();

    expect(fixture).toContain("<SessionTranscript");
    expect(fixture).toContain('error: { name: "MessageAbortedError" }');
    expect(fixture).toContain("isStreaming={true}");
    expect(fixture).toContain("reasoningMessages");
    expect(fixture).toContain("Live detail 24");
    expect(fixture).toContain("Append streaming reasoning");
    expect(fixture).toContain("data-entry={fixtureEntry}");
    expect(fixture).toContain('entryParam === "code" || entryParam === "expert"');
    expect(fixture).toContain('languageParam === "zh" || languageParam === "zh-TW"');
    expect(fixture).toContain("setLocale(languageParam)");
  });
});
