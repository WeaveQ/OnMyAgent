/** @jsxImportSource react */
import { memo, type CSSProperties } from "react";
import {
  CircleAlert,
} from "lucide-react";

import {
  revealDesktopItemCandidates,
} from "../../../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { currentLocale, t } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX,
  type MessageGroup,
} from "../../../../../app/types";
import { isOutputLimitContinuationMessageId } from "../../sync/output-limit-recovery";
import { MarkdownBlock } from "../markdown";
import { TranscriptResourceChip } from "../transcript-resource-chip";
import {
  resolveArtifactRevealCandidates,
  type OpenTarget,
} from "../../artifacts/open-target";
import { ArtifactIcon } from "../../artifacts/artifact-icon";
import {
  messageBlockStyle,
  messageStateClass,
  messageTextClass,
} from "./styles";
import { partToText } from "./parts";
import {
  TranscriptAssistantHeader,
  TranscriptCancelledIndicator,
  TranscriptTurnActions,
  TranscriptUserToolbar,
} from "./chrome";
import { FileCard } from "./file-card";
import { SkillReferenceText } from "./skill-text";
import { StepsContainer } from "./steps-container";
import { WorkBuddyTurnContent } from "./turn-content";
import {
  messageBlockRowPropsEqual,
  type MessageBlockRowMemoProps,
} from "./message-block-row-equality";

function messageGroupKey(messageId: string, group: MessageGroup) {
  if (group.kind === "steps") return `${messageId}:steps:${group.id}`;
  const partId = "id" in group.part && typeof group.part.id === "string" ? group.part.id : partToText(group.part);
  return `${messageId}:text:${group.segment}:${partId}`;
}

function OpenTargetIcon(props: { target: OpenTarget }) {
  return (
    <ArtifactIcon
      type={props.target.preview}
      name={props.target.name || props.target.value}
      className="size-3.5 shrink-0"
    />
  );
}

function OpenableTargetsStrip(props: {
  targets: OpenTarget[];
  onOpenTarget: (target: OpenTarget) => void;
  workspaceRoot?: string;
}) {
  if (!props.targets.length) return null;
  const openInFolder = async (target: OpenTarget) => {
    if (target.kind !== "file") {
      props.onOpenTarget(target);
      return;
    }
    const candidates = resolveArtifactRevealCandidates(target.value, {
      workspaceRoot: props.workspaceRoot,
      verifiedValue: target.value,
    });
    try {
      await revealDesktopItemCandidates(candidates);
    } catch (error) {
      console.error("Failed to open artifact in folder:", error, candidates);
      // Always give the user a working path: open in-app artifact panel.
      props.onOpenTarget(target);
    }
  };
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs leading-none">
      <span className="mr-0.5 text-dls-secondary">{t("session.openable_items")}</span>
      {props.targets.map((target) => (
          <Button
            key={target.id}
            type="button"
            variant="outline"
            size="xs"
            className="session-generated-artifact-card max-w-[220px] rounded-lg text-dls-text hover:text-dls-text"
            title={target.value}
            onClick={() => void openInFolder(target)}
          >
            <OpenTargetIcon target={target} />
            <span className="truncate">{target.name || target.value}</span>
            <span className="text-dls-secondary">
              {target.kind === "url"
                ? t("session.open_browser")
                : t("session.open_artifact")}
            </span>
          </Button>
        ))}
    </div>
  );
}

function MessageBlockRowInner(props: MessageBlockRowMemoProps) {
  const block = props.block;
  const turnPresentation = props.turnPresentation;
  const onTurnDetailsExpandedChange = (expanded: boolean) => {
    if (turnPresentation) {
      props.onTurnDetailsExpandedChange(turnPresentation.turnId, expanded);
    }
  };
  const controlledTurnDetailsChange = turnPresentation
    ? onTurnDetailsExpandedChange
    : undefined;
  const blockMessageIds = block.kind === "steps-cluster"
    ? block.messageIds
    : [...(block.leadingStepMessageIds ?? []), block.messageId];
  const hasSearchMatch = blockMessageIds.some((id) => props.searchMatchMessageIds?.has(id));
  const hasActiveSearchMatch = blockMessageIds.some((id) => id === props.activeSearchMessageId);
  const searchOutlineClass = hasActiveSearchMatch
    ? messageStateClass.activeSearchOutline
    : hasSearchMatch
      ? messageStateClass.searchOutline
      : "";
  const perfStyle = props.shouldUseContentVisibility && props.blockIndex < props.totalBlocks - 12
    ? { contentVisibility: "auto", containIntrinsicSize: "180px" } satisfies CSSProperties
    : undefined;
  const blockStyle = messageBlockStyle(perfStyle);
  const assistantAvatar = props.assistantAvatar;
  const showAssistantAvatar =
    props.showAssistantIdentity && !block.isUser && assistantAvatar && !props.isNestedVariant;
  const turnOpenTargets =
    !block.isUser && turnPresentation?.isActionBlock && props.onOpenTarget
      ? props.turnOpenTargets ?? []
      : [];

  if (
    !block.isUser &&
    !props.isNestedVariant &&
    turnPresentation?.turnContent &&
    turnPresentation.isTurnContentAnchor
  ) {
    const turnContent = turnPresentation.turnContent;
    return (
      <div
        className="session-transcript-assistant-row session-transcript-assistant-turn group relative flex flex-col items-start"
        data-message-role="assistant"
        data-message-id={turnContent.anchorMessageId}
        data-workbuddy-turn-anchor="true"
        style={blockStyle}
      >
        <TranscriptAssistantHeader
          assistantAvatar={assistantAvatar}
          showAssistantAvatar={Boolean(showAssistantAvatar)}
          presentation={turnPresentation}
          detailsExpanded={props.turnDetailsExpanded}
          onDetailsExpandedChange={onTurnDetailsExpandedChange}
        />
        <div
          className={cn(
            messageTextClass.baseMessageBubble,
            messageTextClass.assistantMessageBubble,
            messageTextClass.rootAssistantMessageBubble,
            searchOutlineClass,
          )}
        >
          <WorkBuddyTurnContent
            presentation={turnContent}
            detailsExpanded={props.turnDetailsExpanded}
            expandedStepIds={props.expandedStepIds}
            onExpandedStepIdsChange={props.onExpandedStepIdsChange}
            onOpenCodePath={props.onOpenCodePath}
            onDownloadCodePath={props.onDownloadCodePath}
            highlightQuery={hasSearchMatch ? props.searchHighlightQuery : undefined}
            verifiedCodePaths={props.verifiedCodePaths}
          />
          {props.onOpenTarget ? (
            <OpenableTargetsStrip
              targets={turnOpenTargets}
              onOpenTarget={props.onOpenTarget}
              workspaceRoot={props.workspaceRoot}
            />
          ) : null}
        </div>
        <TranscriptCancelledIndicator presentation={turnPresentation} />
        <TranscriptTurnActions
          presentation={turnPresentation}
          onForkAtMessage={props.onForkAtMessage}
        />
      </div>
    );
  }

  if (block.kind === "steps-cluster") {
    return (
      <div
        className={cn(
          "flex group justify-start pb-4",
          block.isUser && "justify-end",
          !props.isNestedVariant && block.isUser && "session-transcript-user-row",
          !props.isNestedVariant && !block.isUser && "session-transcript-assistant-row",
          !props.isNestedVariant && !block.isUser && "flex-col items-start",
        )}
        data-message-role={block.isUser ? "user" : "assistant"}
        data-message-id={block.messageIds[0] ?? ""}
        style={blockStyle}
      >
        <TranscriptAssistantHeader
          assistantAvatar={assistantAvatar}
          showAssistantAvatar={Boolean(showAssistantAvatar)}
          presentation={turnPresentation}
          detailsExpanded={props.turnDetailsExpanded}
          onDetailsExpandedChange={onTurnDetailsExpandedChange}
        />
        <div
          className={cn(
            block.isUser
              ? cn(
                "relative",
                messageTextClass.baseMessageBubble,
                messageTextClass.userMessageBubble,
                props.isNestedVariant
                  ? messageTextClass.nestedUserMessageBubble
                  : messageTextClass.rootUserMessageBubble,
              )
              : props.isNestedVariant
                ? messageTextClass.nestedAssistantBubble
                : messageTextClass.assistantBubble,
            searchOutlineClass,
          )}
        >
          <StepsContainer
            stepGroups={block.stepGroups}
            isUser={block.isUser}
            isNestedVariant={props.isNestedVariant}
            isActive={props.isStreaming && block.messageIds.includes(props.latestAssistantMessageId)}
            isTrailingMessageContent={true}
            expandedStepIds={props.expandedStepIds}
            onExpandedStepIdsChange={props.onExpandedStepIdsChange}
            turnDetailsExpanded={props.turnDetailsExpanded}
            onTurnDetailsExpandedChange={controlledTurnDetailsChange}
            onOpenCodePath={props.onOpenCodePath}
          />
        </div>
        <TranscriptCancelledIndicator presentation={turnPresentation} />
        {turnPresentation ? (
          <TranscriptTurnActions
            presentation={turnPresentation}
            onForkAtMessage={props.onForkAtMessage}
          />
        ) : null}
      </div>
    );
  }

  const groupSpacing = block.isUser ? "mb-3" : "mb-4";
  const isSyntheticSessionError =
    !block.isUser && block.messageId.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX);
  const isOutputLimitContinuation =
    block.isUser &&
    !props.isNestedVariant &&
    isOutputLimitContinuationMessageId(block.messageId);

  if (isOutputLimitContinuation) {
    const continuationText = block.renderableParts
      .map((part) => partToText(part))
      .join(" ")
      .trim();
    return (
      <div
        className="pb-4"
        data-message-role="user"
        data-message-id={block.messageId}
        data-output-limit-continuation="true"
        style={blockStyle}
      >
        <div className="flex items-center gap-3 text-xs text-dls-secondary">
          <span className="h-px flex-1 bg-dls-border" aria-hidden="true" />
          <span>{continuationText}</span>
          <span className="h-px flex-1 bg-dls-border" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (isSyntheticSessionError) {
    const messageText = block.renderableParts
      .map((part) => partToText(part))
      .join(" ")
      .replace(/\s*\n+\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    return (
      <div
        className={cn(
          "flex group justify-start pb-4",
          !props.isNestedVariant && "session-transcript-assistant-row",
          !props.isNestedVariant && "flex-col items-start",
        )}
        data-message-role="assistant"
        data-message-id={block.messageId}
        style={blockStyle}
      >
        <TranscriptAssistantHeader
          assistantAvatar={assistantAvatar}
          showAssistantAvatar={Boolean(showAssistantAvatar)}
          presentation={turnPresentation}
          detailsExpanded={props.turnDetailsExpanded}
          onDetailsExpandedChange={onTurnDetailsExpandedChange}
        />
        <div className={cn("w-full relative", !props.isNestedVariant && "max-w-[650px]", searchOutlineClass)}>
          <NoticeBox className="inline-flex max-w-full items-start gap-2 text-sm leading-5" role="alert" tone="error">
            <CircleAlert size={14} className="mt-0.5 shrink-0" />
            <div className="min-w-0 wrap-break-word">{messageText}</div>
          </NoticeBox>
        </div>
        <TranscriptCancelledIndicator presentation={turnPresentation} />
        {turnPresentation ? (
          <TranscriptTurnActions
            presentation={turnPresentation}
            onForkAtMessage={props.onForkAtMessage}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex group justify-start relative pb-4",
        block.isUser && "justify-end",
        !props.isNestedVariant && !block.isUser && "session-transcript-assistant-message-row",
        !props.isNestedVariant && block.isUser && "session-transcript-user-row",
        !props.isNestedVariant && !block.isUser && "session-transcript-assistant-row",
        !props.isNestedVariant && !block.isUser && "flex-col items-start",
      )}
      data-message-role={block.isUser ? "user" : "assistant"}
      data-message-id={block.messageId}
      style={blockStyle}
    >
      <TranscriptAssistantHeader
        assistantAvatar={assistantAvatar}
        showAssistantAvatar={Boolean(showAssistantAvatar)}
        presentation={turnPresentation}
        detailsExpanded={props.turnDetailsExpanded}
        onDetailsExpandedChange={onTurnDetailsExpandedChange}
      />
      <div
        className={cn(
          messageTextClass.baseMessageBubble,
          block.isUser && messageTextClass.userMessageBubble,
          block.isUser && props.isNestedVariant && messageTextClass.nestedUserMessageBubble,
          block.isUser && !props.isNestedVariant && messageTextClass.rootUserMessageBubble,
          !block.isUser && messageTextClass.assistantMessageBubble,
          !block.isUser && !props.isNestedVariant && messageTextClass.rootAssistantMessageBubble,
          searchOutlineClass,
        )}
      >
        {block.leadingStepGroups?.length ? (
          <div className="mb-4">
            <StepsContainer
              stepGroups={block.leadingStepGroups}
              isUser={block.isUser}
              isNestedVariant={props.isNestedVariant}
              isActive={props.isStreaming && (block.leadingStepMessageIds ?? []).includes(props.latestAssistantMessageId)}
              isTrailingMessageContent={false}
              expandedStepIds={props.expandedStepIds}
              onExpandedStepIdsChange={props.onExpandedStepIdsChange}
              turnDetailsExpanded={props.turnDetailsExpanded}
              onTurnDetailsExpandedChange={controlledTurnDetailsChange}
              onOpenCodePath={props.onOpenCodePath}
            />
          </div>
        ) : null}

        {block.attachments.length > 0 ? (
          <div className={cn("flex flex-wrap gap-2", block.isUser ? "mb-3" : "mb-4")}>
            {block.attachments.map((attachment) => block.isUser ? (
              <TranscriptResourceChip
                key={`${block.messageId}:${attachment.url}:${attachment.relativePath ?? ""}`}
                filename={attachment.filename}
                url={attachment.url}
                mediaType={attachment.mime}
                relativePath={attachment.relativePath}
                workspaceRoot={props.workspaceRoot}
              />
            ) : (
              <FileCard
                key={`${block.messageId}:${attachment.url}`}
                part={{
                  filename: attachment.filename,
                  url: attachment.url,
                  mediaType: attachment.mime,
                }}
                tone="assistant"
              />
            ))}
          </div>
        ) : null}

        {block.groups.map((group, groupIndex) => {
          const highlightQuery = hasSearchMatch ? props.searchHighlightQuery : undefined;
          const isStreamingLatestAssistant =
            !block.isUser && props.isStreaming && block.messageId === props.latestAssistantMessageId;

          return (
            <div key={messageGroupKey(block.messageId, group)} className={cn(group !== block.groups.at(-1) && groupSpacing)}>
              {group.kind === "text" ? (() => {
                if (group.part.type === "file") {
                  const filePart = group.part as {
                    filename?: string;
                    url?: string;
                    mime?: string;
                  };
                  return block.isUser ? (
                    <TranscriptResourceChip
                      filename={filePart.filename}
                      url={filePart.url ?? ""}
                      mediaType={filePart.mime ?? "application/octet-stream"}
                    />
                  ) : (
                    <FileCard
                      part={{
                        filename: filePart.filename,
                        url: filePart.url ?? "",
                        mediaType: filePart.mime ?? "application/octet-stream",
                      }}
                      tone="assistant"
                    />
                  );
                }

                const text = partToText(group.part);
                if (block.isUser) {
                  return (
                    <SkillReferenceText
                      text={text}
                      highlightQuery={highlightQuery}
                    />
                  );
                }

                return (
                  <MarkdownBlock
                    text={text}
                    streaming={isStreamingLatestAssistant}
                    showStreamingCursor={false}
                    highlightQuery={highlightQuery}
                    locale={currentLocale()}
                    onOpenCodePath={props.onOpenCodePath}
                    verifiedCodePaths={props.verifiedCodePaths}
                  />
                );
              })() : null}

              {group.kind === "steps" ? (
                <StepsContainer
                  stepGroups={[{
                    id: group.id,
                    parts: group.parts,
                    mode: group.mode,
                  }]}
                  isUser={block.isUser}
                  isInline={true}
                  isNestedVariant={props.isNestedVariant}
                  isActive={isStreamingLatestAssistant}
                  isTrailingMessageContent={groupIndex === block.groups.length - 1}
                  expandedStepIds={props.expandedStepIds}
                  onExpandedStepIdsChange={props.onExpandedStepIdsChange}
                  turnDetailsExpanded={props.turnDetailsExpanded}
                  onTurnDetailsExpandedChange={controlledTurnDetailsChange}
                  onOpenCodePath={props.onOpenCodePath}
                />
              ) : null}
            </div>
          );
        })}

        {props.onOpenTarget ? (
          <OpenableTargetsStrip
            targets={turnOpenTargets}
            onOpenTarget={props.onOpenTarget}
            workspaceRoot={props.workspaceRoot}
          />
        ) : null}
      </div>
      {!props.isNestedVariant && block.isUser ? (
        <TranscriptUserToolbar
          message={block.message}
          onRevertToMessage={props.onRevertToMessage}
        />
      ) : null}
      <TranscriptCancelledIndicator presentation={turnPresentation} />
      {turnPresentation ? (
        <TranscriptTurnActions
          presentation={turnPresentation}
          onForkAtMessage={props.onForkAtMessage}
        />
      ) : null}
    </div>
  );
}

/**
 * Memo at the block-row boundary so non-streaming rows skip commit while the
 * live tail streams. Equality uses stabilizeMessageBlocks pointer reuse.
 */
export const MessageBlockRow = memo(MessageBlockRowInner, messageBlockRowPropsEqual);
MessageBlockRow.displayName = "MessageBlockRow";
