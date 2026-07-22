import { describe, expect, test } from "bun:test";

const messageListSurfaceDir = new URL(
  "../src/react-app/domains/session/surface/",
  import.meta.url,
);
const messageListSourceFiles = [
  "message-list.tsx",
  "message-list/chrome.tsx",
  "message-list/reasoning.tsx",
  "message-list/tool-activity-icon.tsx",
  "message-list/skill-text.tsx",
  "message-list/file-card.tsx",
  "message-list/dividers.ts",
  "message-list/process-fold.ts",
  "message-list/process-fold-ui.tsx",
  "message-list/step-row.tsx",
  "message-list/steps-container.tsx",
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

const sessionSurfacePath = new URL(
  "../src/react-app/domains/session/surface/session-surface.tsx",
  import.meta.url,
);
const appStylesPath = new URL("../src/app/index.css", import.meta.url);
const assistantStatusPath = new URL(
  "../src/react-app/domains/session/surface/chrome/assistant-status.tsx",
  import.meta.url,
);
const transcriptScrollToLatestPath = new URL(
  "../src/react-app/domains/session/surface/chrome/transcript-scroll-to-latest.tsx",
  import.meta.url,
);
const markdownPath = new URL(
  "../src/react-app/capabilities/artifacts/markdown.tsx",
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
const visualFixturePath = new URL(
  "./session-transcript-visual-fixture.tsx",
  import.meta.url,
);

describe("session transcript layout contract", () => {
  test("keeps the WorkBuddy semantic tool icon registry instead of a permanent loader", async () => {
    const messageList = await readMessageListSources();

    for (const category of [
      "skill",
      "terminal",
      "viewed",
      "edit",
      "glob",
      "search",
      "web",
      "delete",
      "completion",
      "plan",
      "agent",
      "image",
      "widget",
      "database",
      "cloud",
      "debug",
    ]) {
      expect(messageList).toContain(`case \"${category}\"`);
    }
    expect(messageList).not.toContain("<LoadingSpinner className={className}");
  });

  test("scopes reasoning shimmer to the latest streaming message owner", async () => {
    const messageList = await readMessageListSources();

    expect(messageList).toContain(
      "const processRunning = running && items.some",
    );
    expect(messageList).toContain(
      "item.messageId === props.presentation.streamingMessageId",
    );
    expect(messageList).toContain("running={processRunning}");
  });

  test("keeps a singleton semantic tool on its own disclosure depth", async () => {
    const visualFixture = await Bun.file(visualFixturePath).text();
    const messageList = await readMessageListSources();

    expect(visualFixture).toContain('sceneParam === "semantic-singleton-tool"');
    expect(visualFixture).toContain("semanticSingletonToolMessages");
    expect(messageList).toContain("const semanticMeta = shouldUseSemanticProcessFold(legacyPart)");
    expect(messageList).toContain("headlineOverride={semanticMeta?.label}");
    expect(messageList).not.toContain("(legacyPart && shouldUseSemanticProcessFold(legacyPart))");
  });

  test("keeps the five-card finance KPI strip on one compact row", async () => {
    const visualFixture = await Bun.file(visualFixturePath).text();

    expect(visualFixture).toContain("repeat(5,minmax(0,1fr))");
    expect(visualFixture).toContain("min-width:0");
    expect(visualFixture).toContain("white-space:nowrap");
    expect(visualFixture).toContain("text-overflow:ellipsis");
    expect(visualFixture).not.toContain("repeat(auto-fit,minmax(150px,1fr))");
  });

  test("keeps WorkBuddy geometry scoped to the root transcript", async () => {
    const messageList = await readMessageListSources();
    const appStyles = await Bun.file(appStylesPath).text();

    expect(messageList).toContain("computeTranscriptMaxContentWidth");
    expect(messageList).toContain("session-transcript-root mx-auto w-full");
    expect(messageList).toContain("session-transcript-user-row");
    expect(messageList).toContain("session-transcript-assistant-row");
    expect(appStyles).toContain("border-radius: 16px 16px 0 16px");
    expect(appStyles).toContain("max-height: 310px");
    expect(appStyles).toContain("padding: 8px 12px");
    expect(appStyles).toContain("padding-inline: 12px");
    expect(appStyles).toContain("padding-inline: 8px");
    expect(appStyles).toContain(".session-transcript-turn-assistant-only");
    expect(messageList).toContain("firstAssistantRenderItemId");
    expect(messageList).toContain("data-transcript-turn-assistant-only");
    expect(appStyles).toContain(".session-inline-visual");
    expect(appStyles).toContain("border-radius: 16px");
    expect(appStyles).toContain("min-height: 360px");
    expect(appStyles).toContain("max-height: 80vh");
    expect(appStyles).toContain("--session-content-table-header: #f7f7f7");
    expect(appStyles).toContain("--session-content-card: #f2f2f2");
    expect(appStyles).toContain("--session-content-border: #ebebeb");
    expect(appStyles).toContain("--session-content-cell: #ffffff");
    expect(appStyles).toContain(".session-markdown-table-header");
    expect(appStyles).toContain(".session-generated-artifact-card");
  });

  test("renders one assistant identity per modeled turn without user chrome", async () => {
    const messageList = await readMessageListSources();

    expect(messageList).toContain("buildTranscriptTurns");
    expect(messageList).toContain("turnPresentationByBlockKey");
    expect(messageList).toContain("isFirstAssistantBlock");
    expect(messageList).not.toContain("function UserAvatar");
    expect(messageList).not.toContain("userIdentity?: { name: string }");
    const messageBlockRow = messageList.slice(
      messageList.indexOf("function MessageBlockRow"),
      messageList.indexOf("function SessionTranscriptInner"),
    );
    expect(messageBlockRow.indexOf('data-workbuddy-turn-anchor="true"')).toBeLessThan(
      messageBlockRow.indexOf('if (block.kind === "steps-cluster")'),
    );
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
    const messageList = await readMessageListSources();
    const appStyles = await Bun.file(appStylesPath).text();

    expect(messageList).toContain("function TranscriptTurnStatus");
    expect(messageList).toContain("props.presentation.turnContent?.turnCollapseEligible !== true");
    expect(messageList).toContain("!props.presentation.hasExecutionDetails");
    expect(messageList).toContain("props.presentation.copyText.trim().length > 0");
    expect(messageList).not.toContain('props.running && "session-transcript-loading-shimmer"');
    expect(messageList).toContain("function TranscriptTurnActions");
    expect(messageList).toContain("function TranscriptSpeechButton");
    expect(messageList).toContain("function TranscriptShareButton");
    expect(messageList).toContain("turnDetailsExpanded={props.turnDetailsExpanded}");
    expect(messageList).not.toContain("disabled={isLockedOpen}");
    expect(messageList).not.toContain("if (props.onTurnDetailsExpandedChange && !detailsExpanded) return null");
    expect(messageList).toContain("function WorkBuddyTurnContent");
    expect(messageList).toContain("function WorkBuddyProcessFold");
    expect(messageList).toContain('t("session.process_summary_deep_thinking")');
    expect(messageList).toContain(
      'isThinking && chip.running && "session-transcript-loading-shimmer"',
    );
    expect(messageList).toContain('data-process-variant={chip.variant}');
    expect(messageList).toContain("const renderSingletonProcess");
    expect(messageList).toContain("const semanticMeta = shouldUseSemanticProcessFold(legacyPart)");
    expect(messageList).toContain("headlineOverride={semanticMeta?.label}");
    expect(messageList).toContain("categoryOverride={semanticMeta?.category}");
    expect(messageList).not.toContain("(legacyPart && shouldUseSemanticProcessFold(legacyPart))");
    expect(messageList).toContain("props.items.length > 1");
    expect(messageList).toContain("function WorkBuddyTaskList");
    expect(messageList).toContain("const showExpandedProcess = !props.presentation.turnCollapseEligible");
    expect(messageList).toContain("!props.presentation.turnCollapseEligible");
    expect(appStyles).toContain(".session-workbuddy-process-head");
    expect(appStyles).toContain(".session-workbuddy-process-fold.is-summary > .session-workbuddy-process-body");
    expect(appStyles).toContain(".session-workbuddy-process-fold.is-thinking > .session-workbuddy-process-body");
    expect(messageList).not.toContain('props.running && chip.variant === "summary"');
    expect(appStyles).toContain("border-left: 4px solid var(--dls-border)");
    expect(appStyles).toContain(".session-workbuddy-task-detail");
    expect(messageList).toContain("<MarkdownBlock");
    expect(appStyles).toContain(".session-transcript-divider-line");
    expect(appStyles).toContain("repeating-linear-gradient");
    expect(messageList).toContain("data-divider-variant={props.variant}");
    expect(appStyles).toContain(".session-transcript-divider-compacting");
    expect(appStyles).toContain("session-transcript-loading-sweep 1.6s linear infinite");
  });

  test("virtualizes root transcripts by turn and reserves the active viewport", async () => {
    const [messageList, sessionSurface] = await Promise.all([
      readMessageListSources(),
      Bun.file(sessionSurfacePath).text(),
    ]);

    expect(messageList).toContain("groupTranscriptRenderItems");
    expect(messageList).toContain("count: virtualRenderItems.length");
    expect(messageList).toContain("detachedTailRenderItem");
    expect(messageList).toContain("renderItems.slice(0, detachedTailRenderItemIndex)");
    expect(messageList).toContain("estimateRenderItemSize");
    expect(messageList).toContain("activeTurnMinHeight");
    expect(messageList).toContain("scrollContainer.clientHeight");
    expect(messageList).not.toContain("updateViewport(entry.contentRect.width, entry.contentRect.height)");
    expect(sessionSurface).toContain("scrollElement={resolveTranscriptScrollElement}");
    expect(messageList).toContain('data-transcript-turn-active={isActiveTurn ? "true" : undefined}');
    expect(messageList).toContain('id: `block:${blockKey}`, turnId: null, blocks: [block]');
  });

  test("matches WorkBuddy loading shimmer and rotating tip timing", async () => {
    const messageList = await readMessageListSources();
    const assistantStatus = await Bun.file(assistantStatusPath).text();
    const appStyles = await Bun.file(appStylesPath).text();

    expect(assistantStatus).toContain("const LOADING_TIP_DELAY_MS = 4_000");
    expect(assistantStatus).toContain("const LOADING_TIP_ROTATION_MS = 10_000");
    expect(assistantStatus).toContain("onMouseEnter={() => setTipsPaused(true)}");
    expect(assistantStatus).toContain("onFocusCapture={() => setTipsPaused(true)}");
    expect(assistantStatus).not.toContain("dismissTips");
    expect(assistantStatus).not.toContain("LOADING_TIPS_DISMISSED_KEY");
    expect(assistantStatus).not.toContain("session.loading_tip_dismiss");
    expect(assistantStatus).toContain("nextLoadingTipIndex(current, tips.length)");
    expect(assistantStatus).toContain('<span aria-hidden="true">·</span>');
    expect(assistantStatus).toContain('className="session-transcript-loading-line"');
    expect(assistantStatus).not.toContain("PaperGrainGradient");
    expect(messageList).not.toContain('props.running && "session-transcript-loading-shimmer"');
    expect(messageList).toContain("const footerRenderItemId = activeRenderItemId");
    expect(messageList).toContain("item.id === footerRenderItemId");
    expect(messageList).toContain(
      '<div className="session-transcript-assistant-row">',
    );
    expect(messageList).not.toContain(
      "!isNestedVariant && props.footer ? props.footer : null",
    );
    expect(appStyles).toContain("background-position: 200% 0");
    expect(appStyles).toContain("background-position: -200% 0");
    expect(appStyles).toContain(
      "color-mix(in srgb, var(--dls-text-primary, #333333) 55%, transparent) 50%",
    );
    expect(appStyles).toContain("session-transcript-loading-sweep 2.2s linear infinite");
    expect(appStyles).toContain(".session-transcript-loading-line");
    expect(appStyles).toContain("min-height: 36px");
    expect(appStyles).toContain("contain: layout style");
    expect(appStyles).toContain("prefers-reduced-motion: reduce");
  });

  test("keeps live activity below root content without a streaming block cursor", async () => {
    const [messageList, markdown] = await Promise.all([
      readMessageListSources(),
      Bun.file(markdownPath).text(),
    ]);

    expect(markdown).toContain("showStreamingCursor?: boolean");
    expect(markdown).toContain("props.showStreamingCursor !== false");
    expect(messageList.match(/showStreamingCursor=\{false\}/g)?.length).toBe(6);
    expect(messageList).toContain("const activeTurnHasAssistantBlock");
    expect(messageList).toContain("item.turnId === activeTurn.id");
    expect(messageList).toContain('block.kind !== "divider" && !block.isUser');
    expect(messageList).not.toContain("activeTurn.assistantMessages.length === 0");
    expect(messageList).toContain("footerNeedsAssistantIdentity");
  });

  test("matches WorkBuddy history skeleton pairs and compact latest control", async () => {
    const transcriptContentPath = new URL(
      "../src/react-app/domains/session/surface/session-surface-transcript-content.tsx",
      import.meta.url,
    );
    const sessionSurfaceLayoutPath = new URL(
      "../src/react-app/domains/session/surface/session-surface-layout.tsx",
      import.meta.url,
    );
    const [assistantStatus, transcriptContent, surfaceLayout, scrollToLatest] = await Promise.all([
      Bun.file(assistantStatusPath).text(),
      Bun.file(transcriptContentPath).text(),
      Bun.file(sessionSurfaceLayoutPath).text(),
      Bun.file(transcriptScrollToLatestPath).text(),
    ]);

    expect(assistantStatus).toContain("export function TranscriptHistorySkeleton");
    expect(assistantStatus).toContain("Array.from({ length: pairCount }");
    expect(assistantStatus).toContain('className="flex justify-end px-4 py-8"');
    expect(assistantStatus).toContain('className="mb-3 flex items-center gap-2.5"');
    expect(transcriptContent).toContain("<TranscriptHistorySkeleton pairCount={3} />");
    expect(surfaceLayout).toContain('label={t("session.jump_to_latest")}');
    expect(scrollToLatest).toContain("aria-label={props.label}");
    expect(scrollToLatest).toContain('<ChevronsDown className="size-4" strokeWidth={2.25} aria-hidden="true" />');
    expect(scrollToLatest).not.toContain(
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
    const messageList = await readMessageListSources();

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
