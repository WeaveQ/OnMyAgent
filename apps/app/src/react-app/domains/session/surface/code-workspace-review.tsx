/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileDiff, GitBranch, PanelRight, Radio, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getCodeWorkspaceEnvironment } from "../../../../app/lib/desktop";
import type { CodeWorkspaceEnvironmentSnapshot } from "@onmyagent/types";
import { t } from "../../../../i18n";
import { codeReviewPollIntervalMs, shouldRunActivePoll } from "../sync/session-poll-policy";

function diffLineClass(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "bg-dls-status-success-soft text-dls-status-success-fg";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "bg-dls-status-danger-soft text-dls-status-danger-fg";
  }
  if (line.startsWith("@@")) return "bg-dls-decision-soft text-dls-accent";
  return "text-dls-text";
}

export function useCodeWorkspaceEnvironment(props: {
  workspacePath: string | null;
  sessionId: string;
  enabled: boolean;
  polling?: boolean;
}) {
  const [snapshot, setSnapshot] =
    useState<CodeWorkspaceEnvironmentSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!props.enabled) return;
    setLoading(true);
    setError(null);
    try {
      setSnapshot(
        await getCodeWorkspaceEnvironment({
          workspacePath: props.workspacePath,
          sessionId: props.sessionId,
        }),
      );
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : t("session.code_toolbar_environment_failed"),
      );
    } finally {
      setLoading(false);
    }
  }, [props.enabled, props.sessionId, props.workspacePath]);

  useEffect(() => {
    if (!props.enabled) {
      setSnapshot(null);
      setError(null);
      return;
    }
    void refresh();
  }, [props.enabled, refresh]);

  useEffect(() => {
    // Install whenever enabled+polling — do not consult document visibility
    // here or a hidden-at-setup tab never resumes after focus returns.
    const intervalMs = codeReviewPollIntervalMs({
      enabled: props.enabled,
      polling: props.polling === true,
    });
    if (intervalMs == null) return;
    const timer = window.setInterval(() => {
      if (!shouldRunActivePoll({ enabled: true })) return;
      void refresh();
    }, intervalMs);
    const onVisibility = () => {
      if (!shouldRunActivePoll({ enabled: true })) return;
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [props.enabled, props.polling, refresh]);

  return { snapshot, error, loading, refresh };
}

export function CodeWorkspaceDiffView(props: {
  snapshot: CodeWorkspaceEnvironmentSnapshot | null;
  error?: string | null;
  loading?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const diffLines = useMemo(
    () => (props.snapshot?.git.diff ? props.snapshot.git.diff.split("\n") : []),
    [props.snapshot?.git.diff],
  );
  const git = props.snapshot?.git;
  const files = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return (git?.files ?? []).filter((file) =>
      query ? file.path.toLowerCase().includes(query) : true,
    );
  }, [filter, git?.files]);

  if (props.error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-dls-status-danger-fg">
        {props.error}
      </div>
    );
  }

  if (props.loading && !props.snapshot) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-dls-secondary">
        <Radio className="size-4 animate-pulse" />
        {t("common.loading")}
      </div>
    );
  }

  if (!git?.available) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-dls-secondary">
        {t("session.code_toolbar_git_unavailable")}
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_280px] bg-dls-surface">
      <div className="flex min-h-0 min-w-0 flex-col border-r border-dls-border">
        <div className="flex min-h-24 shrink-0 flex-col gap-5 border-b border-dls-border px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="flex items-center gap-2 text-base font-semibold text-dls-text"
              >
                <GitBranch className="size-4" />
                {t("session.code_review_branch")}
              </button>
              {git.additions > 0 || git.deletions > 0 ? (
                <span className="flex items-center gap-1 text-sm font-medium">
                  <span className="text-dls-status-success-fg">+{git.additions}</span>
                  <span className="text-dls-status-danger-fg">-{git.deletions}</span>
                </span>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={git.changedFiles === 0}
              className="rounded-full"
            >
              {t("session.code_review_commit_or_push")}
            </Button>
          </div>
          <div className="flex items-center gap-4 text-lg text-dls-secondary">
            <span>{git.branch ?? t("session.code_toolbar_git_unavailable")}</span>
            {git.upstream ? (
              <>
                <span>→</span>
                <span>{git.upstream}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {diffLines.length > 0 ? (
            <div className="min-w-max">
              {diffLines.map((line, index) => (
                <div
                  key={`${index}:${line}`}
                  className={cn(
                    "whitespace-pre px-4 py-0.5 font-mono text-xs leading-5",
                    diffLineClass(line),
                  )}
                >
                  {line || " "}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full min-h-[480px] items-center justify-center px-6 text-center">
              <div className="space-y-3">
                <div className="mx-auto flex size-24 rotate-6 items-center justify-center rounded-xl border border-dls-border text-4xl text-dls-secondary">
                  ±
                </div>
                <div className="text-lg font-semibold text-dls-text">
                  {t("session.code_review_empty_title")}
                </div>
                <div className="text-sm text-dls-secondary">
                  {t("session.code_review_empty_desc")}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <aside className="flex min-h-0 flex-col bg-dls-surface p-4">
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-dls-secondary" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("session.code_review_filter_files")}
            className="h-10 rounded-xl pl-9"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto pt-3">
          {files.length > 0 ? (
            files.map((file) => (
              <div
                key={file.path}
                className="flex min-h-9 items-center gap-2 rounded-lg bg-dls-hover px-3 text-sm text-dls-text"
              >
                <span className="shrink-0 font-mono text-xs text-dls-status-success-fg">M↧</span>
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
                <span className="shrink-0 text-xs">
                  <span className="text-dls-status-success-fg">+{file.additions}</span>{" "}
                  <span className="text-dls-status-danger-fg">-{file.deletions}</span>
                </span>
              </div>
            ))
          ) : (
            <div className="px-2 py-4 text-sm font-medium text-dls-secondary">
              {t("session.code_review_no_matching_files")}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export function CodeWorkspaceReviewPanel(props: {
  workspacePath: string | null;
  sessionId: string | null;
  onClose: () => void;
  embedded?: boolean;
}) {
  const hasWorkspace = Boolean(props.workspacePath?.trim());
  const environment = useCodeWorkspaceEnvironment({
    workspacePath: props.workspacePath,
    sessionId: props.sessionId ?? "",
    enabled: hasWorkspace,
    polling: true,
  });
  const git = environment.snapshot?.git;

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-dls-background"
      data-code-review-panel="true"
    >
      {!props.embedded ? <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-dls-border px-4">
        <FileDiff className="size-4 text-dls-secondary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-dls-text">
            {t("session.code_toolbar_review_changes")}
          </div>
          <div className="truncate text-xs text-dls-secondary">
            {git?.branch ?? t("session.code_toolbar_git_unavailable")}
            {git
              ? ` · ${git.changedFiles} · +${git.additions} -${git.deletions}`
              : ""}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={!hasWorkspace || environment.loading}
          onClick={() => void environment.refresh()}
          aria-label={t("common.refresh")}
          title={t("common.refresh")}
        >
          <RefreshCw className={cn("size-3.5", environment.loading && "animate-spin")} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={props.onClose}
          aria-label={t("session.code_side_panel_close")}
          title={t("session.code_side_panel_close")}
        >
          <PanelRight className="size-3.5" />
        </Button>
      </header> : null}
      <div className="min-h-0 flex-1 overflow-hidden bg-dls-background">
        {hasWorkspace ? (
          <CodeWorkspaceDiffView
            snapshot={environment.snapshot}
            error={environment.error}
            loading={environment.loading}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-dls-secondary">
            {t("session.code_review_empty_desc")}
          </div>
        )}
      </div>
    </div>
  );
}
