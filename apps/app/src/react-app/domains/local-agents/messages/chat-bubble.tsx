/** @jsxImportSource react */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Copy, ExternalLink, FileText, Globe, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { MessageRoleRow } from "@/components/ui/message-role";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ToolApprovalCard,
  ToolApprovalCardBody,
  ToolApprovalCardFooter,
  ToolApprovalCardHeader,
} from "@/components/ui/tool-approval-card";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { openDesktopPath, revealDesktopItemInDir, type PersonalLocalAgent, type PersonalLocalAgentApprovalDecision, type PersonalLocalAgentApprovalRequest, type PersonalLocalAgentConversationMessage, type PersonalLocalAgentRunResult } from "../../../../app/lib/desktop";
import { shortTime } from "../local-agent-formatters";
import type { OpenTarget } from "../../../capabilities/artifacts/open-target";
import { MarkdownBlock } from "../../../capabilities/artifacts/markdown";
import { MessageFileChanges } from "./message-file-changes";
import { MessageTips } from "./message-tips";
import type { ChatMessage } from "./message-types";
import { approvalClass, localAgentLayoutClass, localAgentTextClass } from "./message-style";
import {
  classifiedRunFailureMessage,
  collectRunOpenTargets,
  resolveDesktopPath,
  runTimelineAlreadyShowsFailure,
} from "./message-utils";
import { groupLocalAgentTimeline, LocalAgentTimelineMessage, LocalAgentToolGroupSummary, visibleRunTimelineMessages } from "./timeline-messages";

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
  const timelineMessages = useMemo(() => visibleRunTimelineMessages(run), [run]);
  const timelineItems = useMemo(() => groupLocalAgentTimeline(timelineMessages), [timelineMessages]);

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
    props.message.text.trim().length > 0 ||
    timelineItems.length > 0 ||
    Boolean(throttledThought) ||
    (run && run.status === "running");
  if (!hasContent) return null;

  return (
    <div className={cn("flex gap-3", isUser && "justify-end")}>
      {!isUser ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-dls-decision-soft text-dls-accent">
          <Bot className="size-4" />
        </div>
      ) : null}
      <div className={cn(isUser ? localAgentLayoutClass.userChatMessage : localAgentLayoutClass.assistantChatMessage)}>
        {isUser ? (
          <pre className="whitespace-pre-wrap break-words font-sans">{props.message.text}</pre>
        ) : null}

        {!isUser && throttledThought ? (
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

        {!isUser && timelineItems.length ? (
          <div className={cn("flex flex-col gap-2.5", throttledThought ? "mt-2" : "")} data-testid="local-agent-timeline-body">
            {timelineItems.map((item) => (
              <div key={item.kind === "tool_group" ? item.id : item.message.id} className="min-w-0">
                {item.kind === "tool_group" ? (
                  <LocalAgentToolGroupSummary messages={item.messages} runStatus={run?.status} />
                ) : (
                  <LocalAgentTimelineMessage
                    message={item.message}
                    streaming={run?.status === "running"}
                    runStatus={run?.status}
                    onResolveTip={props.onResolveTip}
                  />
                )}
              </div>
            ))}
          </div>
        ) : null}

        {!isUser && props.message.text.trim() ? (
          <div className={cn((timelineItems.length || throttledThought) ? "mt-2" : "")}>
            <MarkdownBlock text={props.message.text} streaming={run?.status === "running"} />
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
                <div className={localAgentTextClass.approvalTitle}>{t("local_agent.approval_required")}</div>
                {run.pendingApprovals.map((approval) => {
                  const risk = approval.readonly ? "safe" as const : "careful" as const;
                  return (
                  <ToolApprovalCard key={approval.id} risk={risk}>
                    <ToolApprovalCardHeader className="flex-col gap-1 pb-0">
                      <div className="truncate text-xs font-medium text-dls-text">{approval.title}</div>
                      <div className={approvalClass.meta}>{approval.readonly ? t("local_agent.approval_readonly") : t("local_agent.approval_side_effect")}  {approval.method}</div>
                    </ToolApprovalCardHeader>
                    <ToolApprovalCardBody>
                      <pre className={approvalClass.command}>{approval.command || approval.summary}</pre>
                      <div className={approvalClass.cwd}>cwd: {approval.cwd || "--"}</div>
                    </ToolApprovalCardBody>
                    <ToolApprovalCardFooter
                      risk={risk}
                      denyLabel={t("local_agent.approval_decline")}
                      allowOnceLabel={t("local_agent.approval_allow_once")}
                      allowAlwaysLabel={t("local_agent.approval_allow_session")}
                      onDeny={() => props.onResolveApproval?.(approval, "decline")}
                      onAllowOnce={() => props.onResolveApproval?.(approval, "accept")}
                      onAllowAlways={() => props.onResolveApproval?.(approval, "acceptForSession")}
                    />
                  </ToolApprovalCard>
                  );
                })}
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
                  const PrimaryIcon = isUrl ? Globe : ExternalLink;
                  const SecondaryIcon = isUrl ? Copy : FileText;
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
                        <PrimaryIcon className="size-3.5 shrink-0" />
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
                        <SecondaryIcon className="size-3.5" />
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
