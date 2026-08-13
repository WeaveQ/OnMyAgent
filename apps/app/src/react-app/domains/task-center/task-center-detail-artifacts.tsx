/** @jsxImportSource react */
import { useState } from "react";
import { Check, Copy, Download, FileCheck2, FileText, FolderOpen } from "lucide-react";
import type {
  TaskOrchestratorArtifactMetadata,
  TaskOrchestratorHandoffArtifact,
  TaskOrchestratorSnapshot,
} from "@onmyagent/types";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MonoLogBox } from "@/components/ui/mono-log-box";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusDot } from "@/components/ui/status-dot";
import { t } from "@/i18n";
import { revealDesktopItemInDir } from "@/app/lib/desktop";
import { resolveArtifactAbsolutePath } from "@/react-app/capabilities/artifacts/open-target";
import {
  formatTaskCenterTimestamp,
  TaskCenterEmpty,
} from "./task-center-detail-shared";
import {
  taskCenterArtifactLabelKey,
  taskCenterEvidenceLabelKey,
  taskCenterEvidenceProvenanceLabelKey,
  taskCenterStatusDotTone,
  taskCenterStatusLabelKey,
  taskCenterStatusTone,
} from "./task-center-model";

function safeArtifactFilename(summary: string, id: string): string {
  const base = summary.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "artifact";
  const safeId = id.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 12) || "artifact";
  return `${base}-${safeId}.txt`;
}

function lexicallyContainedWorkspacePath(value: string | null, workspaceRoot: string): string | null {
  if (!value?.trim() || !workspaceRoot.trim()) return null;
  const candidate = resolveArtifactAbsolutePath(value, workspaceRoot);
  if (!candidate) return null;
  const normalize = (path: string) => path.trim().replace(/[\\]+/g, "/").replace(/\/+$/, "");
  const root = normalize(workspaceRoot);
  const normalized = normalize(candidate);
  if (normalized.split("/").some((segment) => segment === "..")) return null;
  if (normalized !== root && !normalized.startsWith(`${root}/`)) return null;
  return normalized;
}

function ArtifactHistoryErrorNotice(props: { error: unknown; onRetry?: () => void }) {
  return (
    <NoticeBox role="alert" tone="error" data-task-center-artifacts-error className="flex flex-wrap items-center justify-between gap-3">
      <span>{t("task_center.history_load_failed")}</span>
      <Button type="button" variant="outline" size="sm" disabled={!props.onRetry} data-task-center-artifacts-retry onClick={props.onRetry}>{t("task_center.retry_action")}</Button>
    </NoticeBox>
  );
}

function artifactMetadataFromSnapshot(snapshot: TaskOrchestratorSnapshot): TaskOrchestratorArtifactMetadata[] {
  return snapshot.artifacts.map((artifact) => ({
    ...artifact,
    evidenceCount: artifact.evidence.length,
    contentBytes: new TextEncoder().encode(artifact.content).byteLength,
    contentSha256: "".padStart(64, "0"),
  }));
}

function mergeArtifactMetadata(
  snapshot: TaskOrchestratorSnapshot,
  artifactMetadata: TaskOrchestratorArtifactMetadata[],
): TaskOrchestratorArtifactMetadata[] {
  const records = new Map(artifactMetadata.map((artifact) => [artifact.id, artifact]));
  // Snapshot push/poll can observe a just-committed artifact before the
  // paginated metadata query completes its refetch. Merge it instead of
  // rendering the older metadata page as an exclusive source.
  for (const artifact of artifactMetadataFromSnapshot(snapshot)) {
    if (!records.has(artifact.id)) records.set(artifact.id, artifact);
  }
  return [...records.values()].sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
}

export function TaskCenterArtifactsPanel({
  snapshot,
  artifactMetadata = [],
  artifactContent = {},
  artifactsHasMore = false,
  artifactsLoading = false,
  artifactsError,
  onRetryArtifacts,
  onLoadMoreArtifacts,
  onLoadArtifact,
}: {
  snapshot: TaskOrchestratorSnapshot;
  artifactMetadata?: TaskOrchestratorArtifactMetadata[];
  artifactContent?: Record<string, TaskOrchestratorHandoffArtifact>;
  artifactsHasMore?: boolean;
  artifactsLoading?: boolean;
  artifactsError?: unknown;
  onRetryArtifacts?: () => void;
  onLoadMoreArtifacts?: () => void;
  onLoadArtifact?: (artifactId: string) => Promise<TaskOrchestratorHandoffArtifact>;
}) {
  const [copying, setCopying] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [loadingArtifact, setLoadingArtifact] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const copyContent = async (id: string, content: string) => {
    if (!content) return;
    setCopying(id);
    setCopied(null);
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(content);
      setCopied(id);
    } catch {
      setCopyError(id);
    } finally {
      setCopying(null);
    }
  };
  const loadArtifact = async (id: string, existing: TaskOrchestratorHandoffArtifact | undefined) => {
    if (existing) return existing;
    if (!onLoadArtifact) return null;
    setLoadingArtifact(id);
    setLoadError(null);
    try {
      return await onLoadArtifact(id);
    } catch {
      setLoadError(id);
      throw new Error("artifact load failed");
    } finally {
      setLoadingArtifact(null);
    }
  };
  const snapshotById = new Map(snapshot.artifacts.map((artifact) => [artifact.id, artifact]));
  const records = artifactsError
    ? artifactMetadata
    : mergeArtifactMetadata(snapshot, artifactMetadata);
  if (!records.length) {
    return (
      <div className="space-y-3">
        {artifactsError ? <ArtifactHistoryErrorNotice error={artifactsError} onRetry={onRetryArtifacts} /> : null}
        <TaskCenterEmpty
          icon={FileText}
          title={t("task_center.no_artifacts_title")}
          description={t("task_center.no_artifacts_description")}
        />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {artifactsError ? <ArtifactHistoryErrorNotice error={artifactsError} onRetry={onRetryArtifacts} /> : null}
      {records.map((metadata) => {
        const artifact = artifactContent[metadata.id] ?? snapshotById.get(metadata.id);
        const excerpt = artifact?.content.slice(0, 24_000) ?? "";
        const snapshotContentTruncated = Boolean(snapshot.truncation?.artifactContentTruncatedIds.includes(metadata.id));
        const truncated = Boolean(artifact && excerpt.length < artifact.content.length) || snapshotContentTruncated;
        const copyId = metadata.id;
        // A snapshot can contain a bounded excerpt. Treat that as metadata
        // until the bounded content loader supplies the immutable full content.
        const loadFullArtifact = () => loadArtifact(metadata.id, snapshotContentTruncated ? undefined : artifact);
        const downloadArtifact = async () => {
          try {
            const full = await loadFullArtifact();
            if (!full) return;
            const url = URL.createObjectURL(new Blob([full.content], { type: "text/plain;charset=utf-8" }));
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = safeArtifactFilename(metadata.summary, metadata.id);
            anchor.click();
            URL.revokeObjectURL(url);
          } catch {
            setDownloadError(metadata.id);
          }
        };
        return (
          <Card key={metadata.id} size="sm">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <FileText className="size-4" aria-hidden />
                {metadata.summary}
              </CardTitle>
              <CardDescription>
                {t(taskCenterArtifactLabelKey(metadata.kind))} · {formatTaskCenterTimestamp(metadata.createdAt)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {excerpt ? (
                <MonoLogBox wrap="wrap" className="max-h-96 overflow-auto p-3">
                  {excerpt}
                </MonoLogBox>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={copying === copyId || loadingArtifact === copyId || (!artifact && !onLoadArtifact)} onClick={() => void (async () => { try { const full = await loadFullArtifact(); if (full) await copyContent(copyId, full.content); } catch { /* loadError is rendered below */ } })()}>
                  {copied === copyId ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  {copied === copyId ? t("task_center.copied") : t("task_center.copy_content")}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={loadingArtifact === copyId || (!artifact && !onLoadArtifact)} onClick={() => void downloadArtifact()}><Download className="size-3.5" aria-hidden />{t("task_center.download_content")}</Button>
                {(!artifact || snapshotContentTruncated) && onLoadArtifact ? <Button type="button" variant="outline" size="sm" disabled={loadingArtifact === copyId} onClick={() => { void loadFullArtifact().catch(() => undefined); }}>{loadingArtifact === copyId ? t("task_center.loading_more") : t("task_center.load_full_content")}</Button> : null}
                {truncated ? <span className="text-xs text-dls-secondary">{t("task_center.artifact_excerpt_notice")}</span> : null}
              </div>
              {copyError === copyId ? <NoticeBox tone="error">{t("task_center.copy_failed")}</NoticeBox> : null}
              {loadError === copyId ? <NoticeBox tone="error">{t("task_center.load_failed")}</NoticeBox> : null}
              {downloadError === copyId ? <NoticeBox tone="error">{t("task_center.download_failed")}</NoticeBox> : null}
              <details className="rounded-lg border border-dls-border px-3 py-2" onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open && (!artifact || snapshotContentTruncated) && onLoadArtifact) { void loadFullArtifact().catch(() => undefined); } }}>
                <summary className="cursor-pointer text-sm font-medium">{t("task_center.show_full_content")}</summary>
                <MonoLogBox wrap="wrap" className="mt-3 max-h-[32rem] overflow-auto p-3">{artifact?.content || t(artifact ? "task_center.no_content" : "task_center.load_full_content_hint")}</MonoLogBox>
              </details>
            </CardContent>
          </Card>
        );
      })}
      {artifactsHasMore ? <div className="flex justify-center"><Button type="button" variant="outline" size="sm" disabled={artifactsLoading} onClick={onLoadMoreArtifacts}>{artifactsLoading ? t("task_center.loading_more") : t("task_center.load_more")}</Button></div> : null}
    </div>
  );
}

export function TaskCenterEvidencePanel({
  snapshot,
  artifactMetadata = [],
  artifactContent = {},
  artifactsHasMore = false,
  artifactsLoading = false,
  artifactsError,
  onRetryArtifacts,
  onLoadMoreArtifacts,
  onLoadArtifact,
}: {
  snapshot: TaskOrchestratorSnapshot;
  artifactMetadata?: TaskOrchestratorArtifactMetadata[];
  artifactContent?: Record<string, TaskOrchestratorHandoffArtifact>;
  artifactsHasMore?: boolean;
  artifactsLoading?: boolean;
  artifactsError?: unknown;
  onRetryArtifacts?: () => void;
  onLoadMoreArtifacts?: () => void;
  onLoadArtifact?: (artifactId: string) => Promise<TaskOrchestratorHandoffArtifact>;
}) {
  const [copying, setCopying] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const copyContent = async (id: string, content: string) => {
    if (!content) return;
    setCopying(id);
    setCopied(null);
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(content);
      setCopied(id);
    } catch {
      setCopyError(id);
    } finally {
      setCopying(null);
    }
  };
  const snapshotById = new Map(snapshot.artifacts.map((artifact) => [artifact.id, artifact]));
  const records = artifactsError
    ? artifactMetadata
    : mergeArtifactMetadata(snapshot, artifactMetadata);
  const evidence = records.flatMap((metadata) => {
    const artifact = artifactContent[metadata.id] ?? snapshotById.get(metadata.id);
    return artifact ? artifact.evidence.map((item) => ({ artifact, item })) : [];
  });
  const snapshotEvidencePreview = Boolean(snapshot.truncation?.truncated && snapshot.truncation.omitted.artifactEvidence > 0);
  const unloaded = records.filter((metadata) => {
    const loaded = artifactContent[metadata.id] ?? snapshotById.get(metadata.id);
    const evidenceCount = loaded?.evidence.length ?? 0;
    return metadata.evidenceCount > evidenceCount && !artifactContent[metadata.id] || (snapshotEvidencePreview && !artifactContent[metadata.id] && metadata.evidenceCount > 0);
  });
  const evidenceGaps = records.filter((metadata) => {
    const loaded = artifactContent[metadata.id];
    return Boolean(loaded && loaded.evidence.length < metadata.evidenceCount);
  });
  if (!evidence.length && !unloaded.length && !evidenceGaps.length && !artifactsError) {
    return (
      <TaskCenterEmpty
        icon={FileCheck2}
        title={t("task_center.no_evidence_title")}
        description={t("task_center.no_evidence_description")}
      />
    );
  }
  return (
    <div className="space-y-3">
      {artifactsError ? <ArtifactHistoryErrorNotice error={artifactsError} onRetry={onRetryArtifacts} /> : null}
      {unloaded.map((metadata) => (
        <Card key={metadata.id} variant="outline" size="sm">
          <CardHeader>
            <CardTitle>{metadata.summary}</CardTitle>
            <CardDescription>{t("task_center.evidence_count", { count: metadata.evidenceCount })}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" size="sm" disabled={!onLoadArtifact || revealing === metadata.id} onClick={() => { if (onLoadArtifact) { setRevealing(metadata.id); void onLoadArtifact(metadata.id).catch(() => setRevealError(metadata.id)).finally(() => setRevealing(null)); } }}>{revealing === metadata.id ? t("task_center.loading_more") : t("task_center.load_evidence")}</Button>
            {revealError === metadata.id ? <NoticeBox tone="error">{t("task_center.load_failed")}</NoticeBox> : null}
          </CardContent>
        </Card>
      ))}
      {evidenceGaps.map((metadata) => (
        <NoticeBox key={`evidence-gap-${metadata.id}`} tone="warning" data-task-center-evidence-gap>
          {t("task_center.evidence_pagination_gap")}
        </NoticeBox>
      ))}
      {evidence.map(({ artifact, item }, index) => (
        <Card key={`${artifact.id}-${index}`} variant="outline" size="sm">
          <CardHeader>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <StatusDot size="md" tone={taskCenterStatusDotTone(item.status)} />
              <CardTitle className="min-w-0 flex-1 truncate text-sm">
                {item.label}
              </CardTitle>
              <StatusBadge
                size="tiny"
                shape="soft"
                tone={taskCenterStatusTone(item.status)}
              >
                {t(taskCenterStatusLabelKey(item.status))}
              </StatusBadge>
            </div>
            <CardDescription>
              {t(taskCenterEvidenceLabelKey(item.kind))} · {t(taskCenterEvidenceProvenanceLabelKey(item.provenance))}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {item.value ? (
              <details className="rounded-lg border border-dls-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">{t("task_center.show_full_content")}</summary>
                <MonoLogBox wrap="wrap" className="mt-3 max-h-[32rem] overflow-auto">{item.value}</MonoLogBox>
              </details>
            ) : null}
            {item.path ? <MonoLogBox size="inline">{item.path}</MonoLogBox> : null}
            {item.exitCode !== null ? (
              <div className="text-xs text-dls-secondary">
                {t("task_center.exit_code", { count: item.exitCode })}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!(item.value || item.path) || copying === `${artifact.id}-${index}`} onClick={() => void copyContent(`${artifact.id}-${index}`, item.value || item.path || "")}>
                {copied === `${artifact.id}-${index}` ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                {copied === `${artifact.id}-${index}` ? t("task_center.copied") : t("task_center.copy_content")}
              </Button>
              {(() => {
                const revealTarget = lexicallyContainedWorkspacePath(item.path, snapshot.task.workspaceRoot);
                if (revealTarget) {
                  const revealId = `${artifact.id}-${index}`;
                  return <Button type="button" variant="outline" size="sm" disabled={revealing === revealId} onClick={() => { setRevealing(revealId); setRevealError(null); void revealDesktopItemInDir(revealTarget, snapshot.task.workspaceRoot).catch(() => setRevealError(revealId)).finally(() => setRevealing(null)); }}><FolderOpen className="size-3.5" aria-hidden />{t("task_center.reveal_evidence")}</Button>;
                }
                return item.path ? <span className="text-xs text-dls-secondary">{t("task_center.reveal_unavailable")}</span> : null;
              })()}
            </div>
            {copyError === `${artifact.id}-${index}` ? <NoticeBox tone="error">{t("task_center.copy_failed")}</NoticeBox> : null}
            {revealError === `${artifact.id}-${index}` ? <NoticeBox tone="error">{t("task_center.reveal_failed")}</NoticeBox> : null}
          </CardContent>
        </Card>
      ))}
      {artifactsHasMore ? <div className="flex justify-center"><Button type="button" variant="outline" size="sm" disabled={artifactsLoading} onClick={onLoadMoreArtifacts}>{artifactsLoading ? t("task_center.loading_more") : t("task_center.load_more")}</Button></div> : null}
    </div>
  );
}
