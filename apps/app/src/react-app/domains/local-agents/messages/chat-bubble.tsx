/** @jsxImportSource react */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Copy, FileText, FolderOpen, Globe } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { MessageRoleRow } from "@/components/ui/message-role";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { openDesktopPath, revealDesktopItemInDir, type PersonalLocalAgent, type PersonalLocalAgentApprovalDecision, type PersonalLocalAgentApprovalRequest, type PersonalLocalAgentConversationMessage } from "../../../../app/lib/desktop";
import type { OpenTarget } from "../../../capabilities/artifacts/open-target";
import { ArtifactIcon } from "../../../capabilities/artifacts/artifact-icon";
import { MarkdownBlock } from "../../../capabilities/artifacts/markdown";
import { sanitizeAssistantTranscriptText } from "../../../capabilities/conversation/assistant-text-sanitize";
import { LocalAgentApprovalCard } from "./local-agent-approval-card";
import { MessageFileChanges } from "./message-file-changes";
import type { ChatMessage } from "./message-types";
import { localAgentLayoutClass, localAgentTextClass } from "./message-style";
import { buildLocalAgentPresentation } from "./local-agent-presentation-model";
import {
  classifiedRunFailureMessage,
  collectRunOpenTargets,
  resolveDesktopPath,
  runTimelineAlreadyShowsFailure,
} from "./message-utils";
import { LocalAgentTurnStatus } from "./local-agent-turn-status";
import { buildLocalAgentTurnPresentation } from "./local-agent-turn-presentation";
import { LocalAgentTimelineMessage, visibleRunTimelineMessages } from "./timeline-messages";

export const ChatBubble = memo(function ChatBubble(props: {
  message: ChatMessage;
  workspaceRoot: string;
  agent?: PersonalLocalAgent | null;
  selectedModel?: string;
  onOpenArtifact?: (target: OpenTarget) => Promise<void> | void;
  onResolveApproval?: (approval: PersonalLocalAgentApprovalRequest, decision: PersonalLocalAgentApprovalDecision, options?: { alwaysAllow?: boolean }) => void;
  onResolveTip?: (message: PersonalLocalAgentConversationMessage) => void;
}) {
  const isUser = props.message.role === "user";
  const run = props.message.run;
  const [actionFeedback, setActionFeedback] = useState<{ id: string; tone: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    // Auto-dismiss the copy/open action feedback badge after a short delay.
    if (!actionFeedback) return;
    const timer = window.setTimeout(() => setActionFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [actionFeedback]);
  const showFeedback = useCallback((id: string, tone: "ok" | "error", text: string) => {
    setActionFeedback({ id, tone, text });
  }, []);
  const handleOpenArtifact = useCallback(async (target: OpenTarget) => {
    // Align with Upstream behavior: file artifacts always open via the OS
    // (shell.openPath), regardless of whether the path lives inside the
    // current workspace root. This matches user expectations for local CLI
    // agents (Codex/Claude/Gemini) which frequently emit absolute paths on the
    // user's machine that the workspace-scoped ArtifactPanel cannot resolve.
    if (target.kind === "file") {
      const absolute = resolveDesktopPath(target.value, props.workspaceRoot);
      if (!absolute) {
        showFeedback(`artifact-${target.id}`, "error", t("local_agent.unknown_file_path"));
        return;
      }
      try {
        await openDesktopPath(absolute);
        showFeedback(`artifact-${target.id}`, "ok", t("local_agent.opened_name", { name: target.name }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showFeedback(`artifact-${target.id}`, "error", t("local_agent.open_failed", { message }));
      }
      return;
    }
    // URLs: prefer the host's openTarget (routes to the in-app Browser tab).
    if (props.onOpenArtifact) {
      try {
        await props.onOpenArtifact(target);
        showFeedback(`artifact-${target.id}`, "ok", t("local_agent.artifact_opened_browser", { name: target.name }));
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showFeedback(`artifact-${target.id}`, "error", t("local_agent.open_failed", { message }));
        return;
      }
    }
    try {
      window.open(target.value, "_blank", "noopener,noreferrer");
      showFeedback(`artifact-${target.id}`, "ok", t("local_agent.artifact_opened_system_browser", { name: target.name }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFeedback(`artifact-${target.id}`, "error", t("local_agent.open_failed", { message }));
    }
  }, [props.onOpenArtifact, props.workspaceRoot, showFeedback]);
  const handleRevealArtifact = useCallback(async (target: OpenTarget) => {
    if (target.kind !== "file") {
      try {
        await navigator.clipboard.writeText(target.value);
        showFeedback(`artifact-${target.id}`, "ok", t("local_agent.link_copied"));
      } catch {
        showFeedback(`artifact-${target.id}`, "error", t("local_agent.copy_failed_short"));
      }
      return;
    }
    const absolute = resolveDesktopPath(target.value, props.workspaceRoot);
    if (!absolute) {
      showFeedback(`artifact-${target.id}`, "error", t("local_agent.unknown_file_path"));
      return;
    }
    try {
      await revealDesktopItemInDir(absolute);
      showFeedback(`artifact-${target.id}`, "ok", t("local_agent.revealed_name", { name: target.name }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFeedback(`artifact-${target.id}`, "error", t("local_agent.reveal_failed", { message }));
    }
  }, [props.workspaceRoot, showFeedback]);
  const artifactTargets = useMemo(
    () => collectRunOpenTargets(run, props.workspaceRoot, props.message.text),
    [props.message.text, props.workspaceRoot, run],
  );
  const presentation = useMemo(() => buildLocalAgentPresentation(run), [run]);
  const timelineMessages = useMemo(() => visibleRunTimelineMessages(run), [run]);
  const assistantBodyText = useMemo(
    () => {
      if (isUser) return props.message.text;
      const direct = sanitizeAssistantTranscriptText(props.message.text).text.trim();
      const waitingText = t("local_agent.waiting_for_approval");
      const runningText = t("local_agent.running");
      const waitingSuffix = `\n\n${waitingText}`;
      const withoutDerivedStatus = direct.endsWith(waitingSuffix)
        ? direct.slice(0, -waitingSuffix.length).trim()
        : direct;
      if (run?.pendingApprovals?.length && withoutDerivedStatus === waitingText) return "";
      if (run?.status === "running" && withoutDerivedStatus === runningText) return "";
      return withoutDerivedStatus || sanitizeAssistantTranscriptText(presentation.finalText).text.trim();
    },
    [isUser, presentation.finalText, props.message.text, run?.pendingApprovals?.length, run?.status],
  );
  const turn = useMemo(
    () => buildLocalAgentTurnPresentation(run, timelineMessages, assistantBodyText),
    [assistantBodyText, run, timelineMessages],
  );
  const [detailsExpanded, setDetailsExpanded] = useState(() => !turn.collapseEligible);
  useEffect(() => {
    if (turn.collapseEligible) setDetailsExpanded(false);
  }, [turn.collapseEligible]);
  const showProcess = Boolean(!isUser && turn.hasProcess && (!turn.collapseEligible || detailsExpanded));

  // Transient subject/description shown above
  // the timeline while the turn is streaming. Derived from run.events; cleared
  // when a non-thought/non-status event (assistant text, plan, tool_call,
  // error, finish) arrives afterwards.
  const thoughtHint = useMemo(() => {
    const events = run?.events ?? [];
    if (run?.status !== "running") return null;
    const whitelist = new Set(["thought", "thinking", "status", "start", "log"]);
    let latest: { subject: string; description: string } | null = null;
    for (const event of events) {
      if (event.type === "thought") {
        const subject = (event.subject ?? event.text ?? "").toString();
        const description = (event.description ?? "").toString();
        if (subject.trim()) latest = { subject: subject.trim(), description: description.trim() };
        continue;
      }
      if (!whitelist.has(event.type)) latest = null;
    }
    return latest;
  }, [run?.events, run?.status]);

  const [throttledThought, setThrottledThought] = useState<{ subject: string; description: string } | null>(null);
  useEffect(() => {
    // Throttle updates to 50ms, to smooth flicker.
    if (!thoughtHint) { setThrottledThought(null); return; }
    const timer = window.setTimeout(() => setThrottledThought(thoughtHint), 50);
    return () => window.clearTimeout(timer);
  }, [thoughtHint?.subject, thoughtHint?.description, thoughtHint]);

  // Hide the bubble if there is no actual content to show. A freshly-seeded
  // assistant message can briefly have empty text and no run attached (e.g. the
  // moment a new conversation is created); rendering it produces a stray empty
  // box below the real bubble. User bubbles always render (they carry the prompt).
  const hasContent =
    isUser ||
    assistantBodyText.trim().length > 0 ||
    turn.hasProcess ||
    Boolean(throttledThought) ||
    Boolean(run && (presentation.hasVisibleContent || presentation.activity !== "idle"));
  if (!hasContent) return null;

  const showActivityRow = Boolean(
    !isUser
    && run
    && presentation.activity !== "idle"
    && !turn.hasProcess
    && !throttledThought
    && !presentation.waitingForApproval
    && !assistantBodyText.trim(),
  );
  const activityLabel = presentation.activity === "waiting-approval"
    ? t("local_agent.waiting_for_approval")
    : presentation.activity === "completed"
      ? t("local_agent.status_completed")
      : presentation.activity === "failed"
        ? t("local_agent.status_failed")
        : presentation.activity === "cancelled"
          ? t("local_agent.status_cancelled")
          : presentation.activity === "missing"
            ? t("local_agent.status_missing")
            : t("local_agent.running");

  return (
    <div
      className={cn("flex min-w-0 gap-3", isUser && "justify-end")}
      data-local-agent-activity={!isUser && run ? presentation.activity : undefined}
    >
      {!isUser ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-dls-decision-soft text-dls-accent">
          <Bot className="size-4" />
        </div>
      ) : null}
      <div className={cn(isUser ? localAgentLayoutClass.userChatMessage : localAgentLayoutClass.assistantChatMessage)}>
        {isUser ? (
          <pre className="whitespace-pre-wrap break-words font-sans">{props.message.text}</pre>
        ) : null}

        {!isUser && run && turn.collapseEligible ? (
          <LocalAgentTurnStatus
            status={run.status}
            durationLabel={turn.durationLabel}
            expanded={detailsExpanded}
            onExpandedChange={setDetailsExpanded}
          />
        ) : null}

        {!isUser && throttledThought && !timelineMessages.some((message) => message.type === "thinking") ? (
          <MessageRoleRow role="thinking" className="rounded-md border border-dls-border/60 bg-dls-surface-muted/60 px-3 py-2 text-sm leading-5 text-dls-secondary" data-testid="local-agent-thought-hint">
            <div className="flex items-center gap-2">
              <LoadingSpinner size="sm" className="text-dls-signal" />
              <span className="min-w-0 flex-1 truncate font-medium not-italic text-dls-text">{throttledThought.subject}</span>
            </div>
            {throttledThought.description ? (
              <div className="mt-1 line-clamp-3 text-xs not-italic text-dls-text-tertiary">{throttledThought.description}</div>
            ) : null}
          </MessageRoleRow>
        ) : null}

        {showActivityRow ? (
          <div
            className="flex min-w-0 items-center gap-2 rounded-md border border-dls-border/60 bg-dls-surface-muted/60 px-3 py-2 text-sm leading-5 text-dls-secondary"
            role="status"
            aria-live="polite"
            data-testid="local-agent-activity-row"
          >
            {presentation.activity === "failed" || presentation.activity === "missing" ? (
              <NoticeBox tone="error">{activityLabel}</NoticeBox>
            ) : presentation.activity === "completed" || presentation.activity === "cancelled" ? (
              <StatusBadge tone={presentation.activity === "completed" ? "success" : "neutral"} shape="pill" size="tiny">
                {activityLabel}
              </StatusBadge>
            ) : (
              <>
                <LoadingSpinner size="sm" className="text-dls-signal" />
                <span className="min-w-0 truncate text-dls-text">{activityLabel}</span>
              </>
            )}
          </div>
        ) : null}

        {showProcess ? (
          <div className={cn("flex flex-col gap-2.5", throttledThought ? "mt-2" : "")} data-testid="local-agent-timeline-body">
            {turn.processSteps.map((step) => (
              <div key={step.id} className="min-w-0" data-local-agent-process-kind={step.message.type}>
                <LocalAgentTimelineMessage
                  message={step.message}
                  streaming={run?.status === "running"}
                  runStatus={run?.status}
                  pendingApprovals={run?.pendingApprovals}
                  onResolveApproval={props.onResolveApproval}
                  onResolveTip={props.onResolveTip}
                />
              </div>
            ))}
          </div>
        ) : null}

        {turn.alwaysVisibleSteps.length ? (
          <div className="mt-2 flex min-w-0 flex-col gap-2.5" data-testid="local-agent-turn-pinned">
            {turn.alwaysVisibleSteps.map((step) => (
              <div key={step.id} className="min-w-0">
                <LocalAgentTimelineMessage
                  message={step.message}
                  streaming={run?.status === "running"}
                  runStatus={run?.status}
                  pendingApprovals={run?.pendingApprovals}
                  onResolveApproval={props.onResolveApproval}
                  onResolveTip={props.onResolveTip}
                />
              </div>
            ))}
          </div>
        ) : null}

        {!isUser && assistantBodyText.trim() ? (
          <div className={cn((showProcess || throttledThought || turn.hasProcess) ? "mt-2" : "")} data-testid="local-agent-turn-body">
            <MarkdownBlock text={assistantBodyText} streaming={run?.status === "running"} />
          </div>
        ) : null}

        {run ? (
          <div className="mt-3 space-y-2 text-xs text-dls-secondary">
            {/* Timeline already renders error + tips from run events — don't repeat. */}
            {run.errorInfo && !runTimelineAlreadyShowsFailure(run) ? (
              <NoticeBox tone="error">{classifiedRunFailureMessage(run)}</NoticeBox>
            ) : !run.errorInfo && run.error && !runTimelineAlreadyShowsFailure(run) ? (
              <NoticeBox tone="error">{run.error}</NoticeBox>
            ) : null}
            {run.pendingApprovals?.length ? (
              <div className="space-y-2">
                {run.pendingApprovals
                  .filter((approval) => !timelineMessages.some((message) => message.approval?.id === approval.id))
                  .map((approval) => (
                    <LocalAgentApprovalCard
                      key={approval.id}
                      approval={approval}
                      pending
                      onResolve={props.onResolveApproval}
                    />
                  ))}
              </div>
            ) : null}
            {run?.fileChanges?.length ? (
              <MessageFileChanges
                fileChanges={run.fileChanges}
                onFeedback={(id, tone, text) => showFeedback(`file-change-${id}`, tone, text)}
              />
            ) : null}
            {artifactTargets.length ? (
              <div className={localAgentLayoutClass.artifactPanel}>
                <div className={localAgentTextClass.artifactTitle}><FileText className="size-3.5" />{t("local_agent.artifacts_title")}</div>
                <div className="flex flex-wrap gap-2">
                {artifactTargets.map((target) => {
                  const isUrl = target.kind === "url";
                  const primaryTitle = isUrl
                    ? t("local_agent.open_artifact_in_browser", { name: target.name })
                    : t("local_agent.open_artifact_in_workspace", { name: target.name });
                  const secondaryTitle = isUrl
                    ? t("local_agent.copy_artifact_url", { name: target.name })
                    : t("local_agent.reveal_artifact", { name: target.name });
                  return (
                    <div key={target.id} className="inline-flex max-w-full items-center overflow-hidden rounded-md border border-dls-border bg-dls-surface">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className={localAgentLayoutClass.artifactButton}
                        title={primaryTitle}
                        onClick={() => void handleOpenArtifact(target)}
                      >
                        {isUrl
                          ? <Globe className="size-3.5 shrink-0" />
                          : <ArtifactIcon type={target.preview} name={target.name || target.value} className="size-3.5" />}
                        <span className="truncate">{target.name}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className={localAgentLayoutClass.artifactIconButton}
                        title={secondaryTitle}
                        onClick={() => void handleRevealArtifact(target)}
                      >
                        {isUrl ? <Copy className="size-3.5" /> : <FolderOpen className="size-3.5" />}
                      </Button>
                    </div>
                  );
                })}
                </div>
              </div>
            ) : null}
            {actionFeedback ? (
              <StatusBadge tone={actionFeedback.tone === "ok" ? "success" : "danger"} shape="pill" size="tiny">
                {actionFeedback.text}
              </StatusBadge>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});
ChatBubble.displayName = "ChatBubble";
