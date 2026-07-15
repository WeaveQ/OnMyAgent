import { describe, expect, test } from "bun:test";

const messageListPath = new URL(
  "../src/react-app/domains/session/surface/message-list.tsx",
  import.meta.url,
);
const sessionSurfacePath = new URL(
  "../src/react-app/domains/session/surface/session-surface.tsx",
  import.meta.url,
);
const appStylesPath = new URL("../src/app/index.css", import.meta.url);

describe("session transcript layout contract", () => {
  test("keeps WorkBuddy geometry scoped to the root transcript", async () => {
    const messageList = await Bun.file(messageListPath).text();
    const appStyles = await Bun.file(appStylesPath).text();

    expect(messageList).toContain("computeTranscriptMaxContentWidth");
    expect(messageList).toContain("session-transcript-root mx-auto w-full");
    expect(messageList).toContain("session-transcript-user-row");
    expect(messageList).toContain("session-transcript-assistant-row");
    expect(appStyles).toContain("border-radius: 16px 16px 0 16px");
    expect(appStyles).toContain("max-height: 310px");
    expect(appStyles).toContain("padding: 8px 12px");
    expect(appStyles).toContain("padding-inline: 12px");
  });

  test("renders one assistant identity per modeled turn without user chrome", async () => {
    const messageList = await Bun.file(messageListPath).text();

    expect(messageList).toContain("buildTranscriptTurns");
    expect(messageList).toContain("turnPresentationByBlockKey");
    expect(messageList).toContain("isFirstAssistantBlock");
    expect(messageList).not.toContain("function UserAvatar");
    expect(messageList).not.toContain("userIdentity?: { name: string }");
  });

  test("uses the active header identity and leaves composer coupling out", async () => {
    const sessionSurface = await Bun.file(sessionSurfacePath).text();

    expect(sessionSurface).toContain("assistantAvatar={chatHeaderAgent}");
    expect(sessionSurface).not.toContain("assistantAvatarOverride");
  });

  test("keeps final output visible while folding execution details", async () => {
    const messageList = await Bun.file(messageListPath).text();
    const appStyles = await Bun.file(appStylesPath).text();

    expect(messageList).toContain("function TranscriptTurnStatus");
    expect(messageList).toContain("function TranscriptTurnActions");
    expect(messageList).toContain("turnDetailsExpanded={props.turnDetailsExpanded}");
    expect(messageList).toContain("<MarkdownBlock");
    expect(appStyles).toContain(".session-transcript-divider-line");
    expect(appStyles).toContain("repeating-linear-gradient");
  });

  test("virtualizes root transcripts by turn and reserves the active viewport", async () => {
    const messageList = await Bun.file(messageListPath).text();

    expect(messageList).toContain("groupTranscriptRenderItems");
    expect(messageList).toContain("count: renderItems.length");
    expect(messageList).toContain("estimateRenderItemSize");
    expect(messageList).toContain("activeTurnMinHeight");
    expect(messageList).toContain('data-transcript-turn-active={isActiveTurn ? "true" : undefined}');
    expect(messageList).toContain('id: `block:${blockKey}`, turnId: null, blocks: [block]');
  });
});
