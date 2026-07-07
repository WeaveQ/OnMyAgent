/** @jsxImportSource react */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, ChevronRight, Clipboard, Copy, ExternalLink, FileText, Globe, Loader2, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { openDesktopPath, revealDesktopItemInDir, type PersonalLocalAgent, type PersonalLocalAgentApprovalDecision, type PersonalLocalAgentApprovalRequest, type PersonalLocalAgentConversationMessage, type PersonalLocalAgentRunResult } from "../../../../app/lib/desktop";
import type { OpenTarget } from "../../session/artifacts/open-target";
import { MarkdownBlock } from "../../session/surface/markdown";
import { shortTime } from "../local-agent-formatters";
import { MessageFileChanges } from "./message-file-changes";
import { MessageTips } from "./message-tips";
import type { ChatMessage } from "./message-types";
import { approvalClass, localAgentLayoutClass, localAgentTextClass } from "./message-style";
import { classifiedRunFailureMessage, collectRunOpenTargets, isRunFinal, resolveDesktopPath, runDebugBundle, writeTextToClipboard } from "./message-utils";
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
  const runWorkdir = run?.workdir ?? null;
  const showRunDiagnostics = isRunFinal(run?.status);
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
  const handleCopy = useCallback(async (id: string, value: string | null | undefined, label: string) => {
    const ok = await writeTextToClipboard(value);
    showFeedback(id, ok ? "ok" : "error", ok ? t("local_agent.copy_success", { label }) : t("local_agent.copy_failed", { label }));
  }, [showFeedback]);
  const handleOnMyAgentdir = useCallback(async () => {
    const target = resolveDesktopPath(runWorkdir, props.workspaceRoot);
    if (!target) {
      showFeedback("workdir", "error", t("local_agent.unknown_workdir"));
      return;
    }
    try {
      await openDesktopPath(target);
      showFeedback("workdir", "ok", t("local_agent.workdir_opened"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFeedback("workdir", "error", t("local_agent.open_failed", { message }));
    }
  }, [props.workspaceRoot, runWorkdir, showFeedback]);
  const handleRevealLog = useCallback(async () => {
    const target = resolveDesktopPath(run?.logPath, props.workspaceRoot);
    if (!target) {
      showFeedback("log", "error", t("local_agent.no_log_path"));
      return;
    }
    try {
      await revealDesktopItemInDir(target);
      showFeedback("log", "ok", t("local_agent.log_revealed"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showFeedback("log", "error", t("local_agent.reveal_failed", { message }));
    }
  }, [props.workspaceRoot, run?.logPath, showFeedback]);
  const handleOpenArtifact = useCallback(async (target: OpenTarget) => {
    // Align with AionUi behavior: file artifacts always open via the OS
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

  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [rawLogExpanded, setRawLogExpanded] = useState(false);
  const [runDetailsExpanded, setRunDetailsExpanded] = useState(false);

  // Auto-expand timeline while running, auto-collapse when done
  // BUT keep expanded if there are thinking/plan messages (user may want to review)
  const hasThinkingOrPlan = timelineItems.some(
    (item) => item.kind === "message" && (item.message.type === "thinking" || item.message.type === "plan"),
  );
  useEffect(() => {
    if (run?.status === "running") setTimelineExpanded(true);
    else if (!hasThinkingOrPlan) setTimelineExpanded(false);
  }, [run?.runId, run?.status, hasThinkingOrPlan]);

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
      <div className={cn(localAgentLayoutClass.chatMessage, isUser ? localAgentLayoutClass.userChatMessage : localAgentLayoutClass.assistantChatMessage)}>
        {isUser ? (
          <pre className="whitespace-pre-wrap break-words font-sans">{props.message.text}</pre>
        ) : (
          <MarkdownBlock text={props.message.text} streaming={run?.status === "running"} />
        )}

        {!isUser && throttledThought ? (
          <div className="mt-2 rounded-md border border-dls-border/60 bg-dls-surface-muted/60 px-3 py-2 text-[13px] leading-5 text-dls-secondary" data-testid="local-agent-thought-hint">
            <div className="flex items-center gap-2">
              <Loader2 className="size-3.5 shrink-0 animate-spin text-dls-accent" />
              <span className="min-w-0 flex-1 truncate font-medium text-dls-text">{throttledThought.subject}</span>
            </div>
            {throttledThought.description ? (
              <div className="mt-1 line-clamp-3 text-xs text-dls-tertiary">{throttledThought.description}</div>
            ) : null}
          </div>
        ) : null}

        {!isUser && timelineItems.length ? (
          <div className="mt-2">
            <button
              type="button"
              data-testid="local-agent-timeline-toggle"
              className="inline-flex select-none items-center gap-1.5 text-[13px] leading-none text-dls-accent transition-colors hover:text-dls-accent-strong"
              onClick={() => setTimelineExpanded((value) => !value)}
              aria-expanded={timelineExpanded}
            >
              {run?.status === "running" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              <span>{t("local_agent.timeline_title", { count: timelineItems.length })}</span>
              <ChevronRight className={cn("size-3 text-dls-secondary transition-transform", timelineExpanded && "rotate-90")} />
            </button>
            {timelineExpanded ? <div className="mt-2 flex flex-col gap-2.5" data-testid="local-agent-timeline-body">
              {timelineItems.map((item) => (
                <div key={item.kind === "tool_group" ? item.id : item.message.id} className="min-w-0">
                  {item.kind === "tool_group" ? (
                    <LocalAgentToolGroupSummary messages={item.messages} />
                  ) : (
                    <LocalAgentTimelineMessage message={item.message} streaming={run?.status === "running"} onResolveTip={props.onResolveTip} />
                  )}
                </div>
              ))}
            </div> : null}
          </div>
        ) : null}

        {run ? (
          <div className="mt-3 space-y-2 text-xs text-dls-secondary">
            {run.errorInfo ? <NoticeBox tone="error">{classifiedRunFailureMessage(run)}<span className={`ml-2 ${localAgentTextClass.debugMeta}`}>{run.errorInfo.code}</span></NoticeBox> : run.error ? <NoticeBox tone="error">{run.error}</NoticeBox> : null}
            {run.pendingApprovals?.length ? (
              <div className={approvalClass.panel}>
                <div className={localAgentTextClass.approvalTitle}>{t("local_agent.approval_required")}</div>
                {run.pendingApprovals.map((approval) => (
                  <div key={approval.id} className={approvalClass.item}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{approval.title}</div>
                        <div className={approvalClass.meta}>{approval.readonly ? t("local_agent.approval_readonly") : t("local_agent.approval_side_effect")}  {approval.method}</div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button size="xs" variant="outline" className="bg-dls-surface" onClick={() => props.onResolveApproval?.(approval, "accept")}>{t("local_agent.approval_allow_once")}</Button>
                        <Button size="xs" onClick={() => props.onResolveApproval?.(approval, "acceptForSession")}>{t("local_agent.approval_allow_session")}</Button>
                        <Button size="xs" variant="outline" className="bg-dls-surface" onClick={() => props.onResolveApproval?.(approval, "acceptForSession", { alwaysAllow: true })}>{t("local_agent.approval_always_allow")}</Button>
                        <Button size="xs" variant="destructive" onClick={() => props.onResolveApproval?.(approval, "decline")}>{t("local_agent.approval_decline")}</Button>
                      </div>
                    </div>
                    <pre className={approvalClass.command}>{approval.command || approval.summary}</pre>
                    <div className={approvalClass.cwd}>cwd: {approval.cwd || "--"}</div>
                  </div>
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
            {showRunDiagnostics ? (
            <details onToggle={(e) => setRunDetailsExpanded(e.currentTarget.open)} className="rounded-lg bg-dls-surface-muted/60 px-3 py-2">
              <summary className="cursor-pointer select-none text-xs font-medium text-dls-secondary">
                {t("local_agent.run_details_summary", { connection: run.connectionMode || "--", started: shortTime(run.startedAt), finished: shortTime(run.finishedAt) })}
              </summary>
              {runDetailsExpanded ? (
              <>
              <div className="mt-2 grid gap-1.5 text-xs leading-5 text-dls-secondary sm:grid-cols-2">
                <div>{t("local_agent.run_detail_run_id")}<span className="font-mono">{run.runId}</span></div>
                <div>{t("local_agent.run_detail_connection")}<span className="font-medium">{run.connectionMode || "--"}</span></div>
                <div>{t("local_agent.run_detail_provider_session")}<span className="font-mono">{run.providerSessionId ?? "--"}</span></div>
                <div>{t("local_agent.run_detail_resume_key")}<span className="font-mono">{run.resumeKey ?? "--"}</span></div>
                <div>{t("local_agent.run_detail_workdir")}<span className="font-mono">{run.workdir ?? "--"}</span></div>
                <div>{t("local_agent.run_detail_pid")}<span className="font-mono">{run.pid ?? "--"}</span></div>
                <div>{t("local_agent.run_detail_time")}{shortTime(run.startedAt)} - {shortTime(run.finishedAt)}</div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 pt-1">
              {run.logPath ? (
                <Button variant="outline" size="sm" onClick={() => void handleCopy("log-path", run.logPath, t("local_agent.copy_log_path"))}>
                  <Clipboard className="mr-1.5 size-3.5" />{t("local_agent.copy_log_path")}
                </Button>
              ) : null}
              {run.logPath ? (
                <Button variant="outline" size="sm" onClick={() => void handleRevealLog()}>
                  <ExternalLink className="mr-1.5 size-3.5" />{t("local_agent.reveal_log")}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => void handleCopy("debug", runDebugBundle(run, { agent: props.agent ?? null, selectedModel: props.selectedModel }), t("local_agent.copy_debug_bundle"))}>
                <Clipboard className="mr-1.5 size-3.5" />{t("local_agent.copy_debug_bundle")}
              </Button>
              {runWorkdir ? (
                <Button variant="outline" size="sm" onClick={() => void handleOnMyAgentdir()}>
                  <ExternalLink className="mr-1.5 size-3.5" />{t("local_agent.open_run_workdir")}
                </Button>
              ) : null}
              {actionFeedback ? (
                <StatusBadge tone={actionFeedback.tone === "ok" ? "success" : "danger"}>
                  {actionFeedback.text}
                </StatusBadge>
              ) : null}
              </div>
              </>
            ) : null}
            </details>
            ) : null}
            <details onToggle={(e) => setRawLogExpanded(e.currentTarget.open)} className="rounded-lg bg-dls-surface-muted/60 px-3 py-2">
              <summary className="flex cursor-pointer items-center gap-1.5 text-dls-secondary"><TerminalSquare className="size-3.5" />{t("local_agent.raw_log_summary")}</summary>
              {rawLogExpanded ? (
              <div className="mt-2 space-y-2">
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{run.command}</pre>
                {run.debugSummary ? <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-dls-surface px-2 py-1 font-mono text-xs">{run.debugSummary}</pre> : null}
                {run.logPath ? <div className="break-all font-mono text-xs">{run.logPath}</div> : null}
                <textarea
                  readOnly
                  value={runDebugBundle(run, { agent: props.agent ?? null, selectedModel: props.selectedModel })}
                  className="h-24 w-full resize-none rounded border border-dls-border bg-dls-surface p-2 font-mono text-xs text-dls-secondary outline-none"
                  aria-label={t("local_agent.debug_aria")}
                />
                <div className="max-h-52 space-y-1 overflow-auto">
                  {run.events.map((event, index) => (
                    <pre key={`${event.at}-${index}`} className="whitespace-pre-wrap break-words rounded bg-dls-surface px-2 py-1 font-mono text-xs">{event.type}&gt; {event.text}</pre>
                  ))}
                </div>
              </div>
              ) : null}
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
});
ChatBubble.displayName = "ChatBubble";
