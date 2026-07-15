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
const assistantStatusPath = new URL(
  "../src/react-app/domains/session/surface/chrome/assistant-status.tsx",
  import.meta.url,
);
const personalAssistantPath = new URL(
  "../src/react-app/domains/session/surface/chrome/personal-assistant.tsx",
  import.meta.url,
);
const sessionPagePath = new URL(
  "../src/react-app/domains/session/chat/session-page.tsx",
  import.meta.url,
);

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

  test("routes office, code, and selected experts through one shared root surface", async () => {
    const [sessionPage, sessionSurface] = await Promise.all([
      Bun.file(sessionPagePath).text(),
      Bun.file(sessionSurfacePath).text(),
    ]);

    expect(sessionPage.match(/<SessionSurface/g)?.length).toBe(1);
    expect(sessionPage).toContain('useState<AssistantCategoryId>("office")');
    expect(sessionPage).toContain('activeAssistantCategoryId === "code"');
    expect(sessionPage).toContain("agentPanel.activeSidebarView");
    expect(sessionSurface).toContain("<SessionTranscript");
    expect(sessionSurface).toContain("assistantAvatar={chatHeaderAgent}");
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
    expect(messageList).toContain("data-divider-variant={props.variant}");
    expect(appStyles).toContain(".session-transcript-divider-compacting");
    expect(appStyles).toContain("session-transcript-loading-sweep 1.6s linear infinite");
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

  test("matches WorkBuddy loading shimmer and rotating tip timing", async () => {
    const assistantStatus = await Bun.file(assistantStatusPath).text();
    const appStyles = await Bun.file(appStylesPath).text();

    expect(assistantStatus).toContain("const LOADING_TIP_DELAY_MS = 4_000");
    expect(assistantStatus).toContain("const LOADING_TIP_ROTATION_MS = 10_000");
    expect(assistantStatus).toContain("onMouseEnter={() => setTipsPaused(true)}");
    expect(assistantStatus).toContain("onFocusCapture={() => setTipsPaused(true)}");
    expect(assistantStatus).toContain("dismissTips");
    expect(appStyles).toContain("session-transcript-loading-sweep 2.2s linear infinite");
    expect(appStyles).toContain("prefers-reduced-motion: reduce");
  });

  test("matches WorkBuddy history skeleton pairs and compact latest control", async () => {
    const assistantStatus = await Bun.file(assistantStatusPath).text();
    const sessionSurface = await Bun.file(sessionSurfacePath).text();

    expect(assistantStatus).toContain("export function TranscriptHistorySkeleton");
    expect(assistantStatus).toContain("Array.from({ length: pairCount }");
    expect(assistantStatus).toContain('className="flex justify-end px-4 py-8"');
    expect(assistantStatus).toContain('className="mb-3 flex items-center gap-2.5"');
    expect(sessionSurface).toContain("<TranscriptHistorySkeleton pairCount={3} />");
    expect(sessionSurface).toContain('aria-label={t("session.jump_to_latest")}');
    expect(sessionSurface).toContain('<ArrowDown className="size-4" />');
    expect(sessionSurface).not.toContain(
      'rounded-full border border-dls-border bg-dls-surface p-1',
    );
  });

  test("renders real WorkBuddy-style error diagnostics without a dead retry action", async () => {
    const personalAssistant = await Bun.file(personalAssistantPath).text();

    expect(personalAssistant).toContain("<TriangleAlert");
    expect(personalAssistant).toContain('t("session.error_message_id")');
    expect(personalAssistant).toContain('t("session.error_trace_id")');
    expect(personalAssistant).toContain('t("session.error_date")');
    expect(personalAssistant).toContain("navigator.clipboard.writeText(errorDetails)");
    expect(personalAssistant).not.toContain('t("session.error_retry")');
    expect(personalAssistant).not.toContain('className="rounded-full text-dls-text');
  });

  test("localizes WorkBuddy tool details and openable artifact actions", async () => {
    const messageList = await Bun.file(messageListPath).text();

    expect(messageList).toContain('t("session.tool_request")');
    expect(messageList).toContain('t("session.tool_result")');
    expect(messageList).toContain('t("session.tool_error")');
    expect(messageList).toContain('t("session.openable_items")');
    expect(messageList).toContain('t("session.open_browser")');
    expect(messageList).toContain('t("session.open_artifact")');
    expect(messageList).not.toContain(">Openable items<");
    expect(messageList).not.toContain(">Request<");
  });
});
