/** @jsxImportSource react */
import { type CSSProperties, useState } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  FileX2,
  File,
  Folder,
  Globe,
  Image as ImageIcon,
  Maximize2,
  ListTodo,
  LoaderCircle,
  Network,
  Plug,
  Sparkles,
  ExternalLink,
  Terminal,
} from "lucide-react";

import { openDesktopPath } from "../../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { usePlatform } from "../../../kernel/platform";
import type {
  TranscriptSpecializedToolDetails,
  TranscriptDiffLine,
  TranscriptTodoItem,
  TranscriptWriteEdit,
} from "./transcript/tool-presentation";

const checkerboardStyle = {
  backgroundColor: "#2d2d2d",
  backgroundImage:
    "linear-gradient(45deg, #404040 25%, transparent 25%), linear-gradient(-45deg, #404040 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #404040 75%), linear-gradient(-45deg, transparent 75%, #404040 75%)",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
  backgroundSize: "16px 16px",
} satisfies CSSProperties;

function imageSource(image: Extract<TranscriptSpecializedToolDetails, { kind: "image-gen" }>["images"][number]) {
  if (image.base64) return `data:image/png;base64,${image.base64}`;
  if (image.url) return image.url;
  if (!image.localPath) return null;
  return image.localPath.startsWith("file://") ? image.localPath : `file://${image.localPath}`;
}

function truncatedPrompt(prompt: string, limit: number) {
  return prompt.length > limit ? `${prompt.slice(0, limit)}...` : prompt;
}

function webLabel(details: Extract<TranscriptSpecializedToolDetails, { kind: "web-fetch" }>) {
  if (details.title) return details.title;
  if (!details.url) return t("session.tool_web_fetch_page");
  try {
    return new URL(details.url).hostname;
  } catch {
    return details.url;
  }
}

function McpImagePreview(props: {
  source: string;
  index: number;
  onOpen: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="rounded-lg border border-dls-status-danger-border bg-dls-status-danger-soft px-3 py-4 text-center text-xs text-dls-status-danger-fg">
        {t("session.tool_mcp_image_failed")}
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-mcp-image-preview="true"
      className="group relative h-auto max-w-full overflow-hidden rounded-lg border border-dls-border bg-dls-surface-muted p-0 hover:bg-dls-surface-muted"
      aria-label={t("session.tool_mcp_image_open", { index: props.index + 1 })}
      onClick={props.onOpen}
    >
      {loading ? (
        <span className="inline-flex min-h-20 min-w-40 items-center justify-center gap-2 px-4 py-6 text-xs text-dls-secondary">
          <LoadingSpinner />
          {t("session.tool_mcp_image_loading")}
        </span>
      ) : null}
      <img
        src={props.source}
        alt={t("session.tool_mcp_image_alt", { index: props.index + 1 })}
        className={cn("max-h-[300px] max-w-full object-contain", loading && "hidden")}
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
      />
      {!loading ? (
        <span className="pointer-events-none absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-lg bg-dls-surface/90 text-dls-secondary opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 className="size-3.5" aria-hidden="true" />
        </span>
      ) : null}
    </Button>
  );
}

export function specializedToolHeadline(
  details: TranscriptSpecializedToolDetails,
  running: boolean,
) {
  if (details.kind === "command") {
    return details.description || details.command;
  }
  if (details.kind === "write") {
    return t(
      running
        ? details.operation === "append"
          ? "session.tool_write_appending"
          : details.operation === "modify"
          ? "session.tool_write_modifying"
          : "session.tool_write_generating"
        : details.operation === "append"
          ? "session.tool_write_appended"
          : details.operation === "modify"
          ? "session.tool_write_modified"
          : "session.tool_write_generated",
      { file: details.fileName || details.filePath },
    );
  }
  if (details.kind === "file-results") {
    return t(
      running
        ? details.mode === "list"
          ? "session.tool_files_listing"
          : "session.tool_files_searching"
        : details.mode === "list"
          ? "session.tool_files_listed"
          : "session.tool_files_searched",
    );
  }
  if (details.kind === "references") {
    if (running) return t("session.tool_files_searching");
    return details.references.length > 0
      ? t("session.tool_references_found", { count: details.references.length })
      : t("session.tool_files_no_results");
  }
  if (details.kind === "delete") {
    return t(running ? "session.tool_delete_deleting" : "session.tool_delete_deleted", {
      file: details.fileName,
    });
  }
  if (details.kind === "lint") {
    if (running) return t("session.tool_lint_checking", { path: details.pathText });
    return details.errorCount > 0
      ? t("session.tool_lint_found", { count: details.errorCount, path: details.pathText })
      : t("session.tool_lint_none", { path: details.pathText });
  }
  if (details.kind === "web-search") {
    return t(running ? "session.tool_web_search_searching" : "session.tool_web_search_searched", {
      query: details.query || t("session.tool_web_search_web"),
    });
  }
  if (details.kind === "web-fetch") {
    return t(running ? "session.tool_web_fetch_fetching" : "session.tool_web_fetch_fetched", {
      page: webLabel(details),
    });
  }
  if (details.kind === "plan") return t("session.tool_plan_title");
  if (details.kind === "compact-tool") {
    if (details.variant === "memory") {
      return t(
        details.action === "delete"
          ? "session.tool_memory_deleted"
          : details.action === "update"
            ? "session.tool_memory_updated"
            : "session.tool_memory_created",
      );
    }
    if (details.variant === "preview-url") return t("session.tool_preview_url");
    if (details.variant === "read-rules") return t("session.tool_read_rules");
    if (details.variant === "upload-file") return t("session.tool_upload_file");
    if (details.variant === "skill-manage") return t("session.tool_skill_manage");
    if (details.variant === "present-files") return t("session.tool_present_files");
    if (details.variant === "cloud-service") {
      return t(running ? "session.tool_cloud_connecting" : "session.tool_cloud_connected", {
        service: details.summary || t("session.tool_cloud_service"),
      });
    }
    return details.summary || t("session.tool_generic");
  }
  if (details.kind === "mcp") {
    return details.serverName
      ? `${details.serverName}${details.toolName ? ` (${details.toolName})` : ""}`
      : t("session.tool_mcp_called");
  }
  if (details.kind === "mcp-resource") {
    return details.server && details.uri
      ? `${details.server}: ${details.uri.split("/").at(-1) || details.uri}`
      : t("session.tool_mcp_resource");
  }
  if (details.kind === "skill") return details.skillName || t("session.tool_skill");
  if (details.kind === "completion") {
    const status = running
      ? t("session.tool_completion_running")
      : details.success
        ? t("session.tool_completion_succeeded")
        : t("session.tool_completion_failed");
    return details.message ? `${status}: ${details.message}` : status;
  }
  if (details.kind === "open-result") {
    return t(running ? "session.tool_open_result_opening" : "session.tool_open_result_opened", {
      target: details.target.split(/[\\/]/).at(-1) || details.target,
    });
  }
  if (details.kind === "mcp-match") {
    return t(running ? "session.tool_mcp_match_loading" : "session.tool_mcp_match_loaded");
  }
  if (details.kind === "integration") return details.integrationName;
  if (details.kind === "image-gen") {
    if (running || details.status === "generating") {
      return details.prompt
        ? t("session.tool_image_generating_prompt", { prompt: truncatedPrompt(details.prompt, 40) })
        : t("session.tool_image_generating");
    }
    return truncatedPrompt(details.prompt, 50) || t("session.tool_image_title");
  }
  return t("session.tool_task_title", {
    task: details.description || details.subagentName || t("session.tool_task_fallback"),
  });
}

export function specializedToolCanExpand(details: TranscriptSpecializedToolDetails) {
  if (details.kind === "command") {
    return Boolean(
      details.command || details.stdout || details.stderr || details.exitCode !== null,
    );
  }
  if (details.kind === "write") {
    return details.lines.length > 0 || details.edits.length > 0;
  }
  if (details.kind === "file-results") return true;
  if (details.kind === "references") return details.references.length > 0;
  if (details.kind === "delete") return false;
  if (details.kind === "lint") return details.issues.length > 0;
  if (details.kind === "web-search") return details.results.length > 0;
  if (details.kind === "web-fetch") return Boolean(details.content);
  if (details.kind === "plan") return Boolean(details.name || details.overview || details.todos.length);
  if (details.kind === "compact-tool") {
    if (details.variant === "preview-url") return false;
    if (details.variant === "memory") return Boolean(details.title || details.summary);
    return Boolean(details.result);
  }
  if (details.kind === "mcp") {
    return Boolean(Object.keys(details.args).length || details.content.length || details.errorMessage || details.progress);
  }
  if (details.kind === "mcp-resource") return Boolean(details.uri || details.content || details.downloadPath);
  if (details.kind === "skill") return false;
  if (details.kind === "completion") return Boolean(details.details);
  if (details.kind === "open-result") return false;
  if (details.kind === "mcp-match") return details.requests.length > 0;
  if (details.kind === "integration") {
    return Boolean(details.result || details.searchResults.length || details.hint);
  }
  if (details.kind === "image-gen") return true;
  return Boolean(details.toolItems.length || details.finalResult);
}

export function ImageGenerationToolCard(props: {
  details: Extract<TranscriptSpecializedToolDetails, { kind: "image-gen" }>;
  running: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const platform = usePlatform();
  const status = props.running ? "generating" : props.details.status;
  const headline = specializedToolHeadline(props.details, props.running);
  const usableImages = props.details.images.flatMap((image) => {
    const source = imageSource(image);
    return source ? [{ image, source }] : [];
  });

  return (
    <div className="w-full overflow-hidden rounded-md border border-dls-border bg-dls-surface">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-between gap-3 rounded-none border-b border-dls-border bg-dls-surface-muted px-3 py-2.5 font-normal text-dls-text hover:bg-dls-hover"
        aria-expanded={props.expanded}
        onClick={props.onToggle}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <ImageIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate text-sm">{headline}</span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", !props.expanded && "-rotate-90")}
          aria-hidden="true"
        />
      </Button>
      {props.expanded ? (
        <div className="my-1">
          {status === "generating" ? (
            <div className="p-3">
              <div className="flex min-h-[200px] items-center justify-center overflow-hidden rounded-sm" style={checkerboardStyle}>
                <LoadingSpinner className="size-8 border-white/20 border-t-dls-accent" />
              </div>
            </div>
          ) : null}
          {status === "error" ? (
            <div className="p-3">
              <div className="flex min-h-[200px] items-center justify-center overflow-hidden rounded-sm px-4 text-center text-sm text-dls-status-danger-fg" style={checkerboardStyle}>
                {props.details.errorMessage || t("session.tool_image_failed")}
              </div>
            </div>
          ) : null}
          {status === "completed" && usableImages.length > 0 ? (
            <div className="divide-y divide-dls-border">
              {usableImages.map(({ image, source }, index) => (
                <div key={`${source}:${index}`} className="overflow-hidden">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto w-full rounded-none p-3 hover:bg-transparent"
                    style={checkerboardStyle}
                    title={t("session.tool_image_open", { index: index + 1 })}
                    onClick={() => {
                      if (image.url) platform.openLink(image.url);
                      else if (image.localPath) void openDesktopPath(image.localPath);
                    }}
                  >
                    <img
                      src={source}
                      alt={t("session.tool_image_alt", { index: index + 1 })}
                      loading="lazy"
                      decoding="async"
                      className="max-h-[400px] max-w-full rounded-xs object-contain"
                    />
                  </Button>
                  {image.localPath ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto w-full justify-start rounded-none bg-dls-surface-muted px-3 py-2 font-mono text-xs font-normal text-dls-secondary hover:bg-dls-hover hover:text-dls-accent"
                      title={image.localPath}
                      onClick={() => void openDesktopPath(image.localPath ?? "")}
                    >
                      <span className="truncate">{image.localPath}</span>
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {status === "completed" && usableImages.length === 0 ? (
            <div className="p-3">
              <div className="flex min-h-[200px] items-center justify-center overflow-hidden rounded-sm px-4 text-center text-sm text-dls-status-danger-fg" style={checkerboardStyle}>
                {t("session.tool_image_no_data")}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TodoStatusIcon(props: { item: TranscriptTodoItem }) {
  const className = "size-3.5 shrink-0";
  if (props.item.status === "completed") {
    return <Check className={cn(className, "text-dls-status-success-fg")} />;
  }
  if (props.item.status === "in_progress") {
    return <LoaderCircle className={cn(className, "animate-spin text-dls-accent")} />;
  }
  if (props.item.status === "cancelled") {
    return <CircleAlert className={cn(className, "text-dls-status-danger-fg")} />;
  }
  return <Circle className={cn(className, "text-dls-secondary")} />;
}

function diffLineTone(kind: TranscriptDiffLine["kind"]) {
  if (kind === "added") {
    return "border-dls-status-success-fg bg-dls-status-success-soft";
  }
  if (kind === "removed") {
    return "border-dls-status-danger-fg bg-dls-status-danger-soft";
  }
  return "border-transparent";
}

function DiffLines(props: { lines: TranscriptDiffLine[]; omittedCount: number }) {
  return (
    <div className="overflow-x-auto font-mono text-xs leading-[18px] text-dls-text">
      {props.lines.map((line, index) => (
        <div
          key={`${line.kind}:${index}:${line.text}`}
          className={cn("flex min-w-full items-start", diffLineTone(line.kind))}
        >
          <span
            className={cn(
              "h-[18px] w-4 shrink-0 border-l-2 bg-inherit",
              diffLineTone(line.kind),
            )}
            aria-hidden="true"
          />
          <span className="min-w-max flex-1 whitespace-pre pr-3">{line.text || " "}</span>
        </div>
      ))}
      {props.omittedCount > 0 ? (
        <div className="px-4 py-2 font-sans text-xs text-dls-secondary">
          {t("session.tool_write_more_lines", { count: props.omittedCount })}
        </div>
      ) : null}
    </div>
  );
}

function CommandToolDetails(props: {
  details: Extract<TranscriptSpecializedToolDetails, { kind: "command" }>;
}) {
  const stdout = props.details.stdout.trim();
  const stderr = props.details.stderr.trim();
  const succeededWithoutOutput = props.details.exitCode === 0 && !stdout && !stderr;
  return (
    <div
      data-tool-details="command"
      className="my-1 max-h-[300px] overflow-y-auto rounded-xl bg-dls-surface-muted px-4 py-3 text-xs text-dls-text"
    >
      <div className="inline-flex items-center gap-2 leading-5">
        <Terminal className="size-3.5 shrink-0 text-dls-secondary" aria-hidden="true" />
        <span>bash</span>
      </div>
      {props.details.command ? (
        <div className="whitespace-pre-wrap wrap-break-word py-1 font-mono leading-[21px]">
          {props.details.command}
        </div>
      ) : null}
      <div className="py-1 font-mono leading-[18px]">
        {stdout ? <div className="whitespace-pre-wrap wrap-break-word">{stdout}</div> : null}
        {stderr ? (
          <div className="whitespace-pre-wrap wrap-break-word text-dls-status-danger-fg">
            {stderr}
          </div>
        ) : null}
        {succeededWithoutOutput ? (
          <div className="inline-flex items-center gap-1">
            <span>{t("session.tool_command_success")}</span>
            <Check className="size-4 shrink-0" aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WriteEditSection(props: {
  edit: TranscriptWriteEdit;
  index: number;
  total: number;
}) {
  return (
    <div className="border-b border-dls-border last:border-b-0">
      <div className="flex items-center justify-between gap-3 bg-dls-surface px-4 py-2 text-xs">
        <span className="font-medium text-dls-text">
          {t("session.tool_write_edit_index", {
            index: props.index + 1,
            total: props.total,
          })}
        </span>
        <span className="inline-flex shrink-0 items-center gap-2">
          {props.edit.addedLines > 0 ? (
            <span className="text-dls-status-success-fg">+{props.edit.addedLines}</span>
          ) : null}
          {props.edit.removedLines > 0 ? (
            <span className="text-dls-status-danger-fg">-{props.edit.removedLines}</span>
          ) : null}
        </span>
      </div>
      <DiffLines lines={props.edit.lines} omittedCount={props.edit.omittedCount} />
    </div>
  );
}

function WriteToolDetails(props: {
  details: Extract<TranscriptSpecializedToolDetails, { kind: "write" }>;
}) {
  return (
    <div
      data-tool-details="write"
      className="my-1 max-h-[300px] overflow-auto rounded-xl bg-dls-surface-muted"
    >
      {props.details.edits.length > 0 ? (
        props.details.edits.map((edit, index) => (
          <WriteEditSection
            key={`${index}:${edit.addedLines}:${edit.removedLines}`}
            edit={edit}
            index={index}
            total={props.details.edits.length}
          />
        ))
      ) : props.details.operation === "create" ? (
        <pre className="m-0 overflow-visible whitespace-pre p-3 font-mono text-xs leading-[18px] text-dls-text">
          {props.details.lines.map((line) => line.text).join("\n")}
          {props.details.omittedCount > 0 ? (
            <span className="mt-2 block font-sans text-dls-secondary">
              {t("session.tool_write_more_lines", { count: props.details.omittedCount })}
            </span>
          ) : null}
        </pre>
      ) : (
        <DiffLines lines={props.details.lines} omittedCount={props.details.omittedCount} />
      )}
    </div>
  );
}

function relativeFolderPath(path: string, directory: string) {
  const normalizedPath = path.endsWith("/") ? path.slice(0, -1) : path;
  const lastSlash = normalizedPath.lastIndexOf("/");
  const folder = lastSlash > 0 ? normalizedPath.slice(0, lastSlash) : "";
  if (!folder || folder === directory) return basenameForDisplay(directory);
  if (directory && folder.startsWith(`${directory}/`)) return folder.slice(directory.length + 1);
  return folder;
}

function basenameForDisplay(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || normalized;
}

function fileResultLineLabel(startLine: number | null, endLine: number | null) {
  if (startLine === null || startLine <= 0 || endLine === null || endLine <= 0) return null;
  return startLine === endLine ? `#L${startLine}` : `#L${startLine}-L${endLine}`;
}

function FileResultsToolDetails(props: {
  details: Extract<TranscriptSpecializedToolDetails, { kind: "file-results" }>;
  onOpenCodePath?: (path: string) => void;
}) {
  return (
    <div data-tool-details="file-results" className="my-1 text-xs">
      {props.details.items.length > 0 ? (
        <div className="max-h-[360px] overflow-y-auto">
          {props.details.items.map((item, index) => {
            const Icon = item.isDirectory ? Folder : File;
            const folderPath = relativeFolderPath(item.path, props.details.directory);
            const lineLabel = fileResultLineLabel(item.startLine, item.endLine);
            const content = (
              <>
                <Icon className="size-3.5 shrink-0 text-dls-secondary" aria-hidden="true" />
                <span className="min-w-0 max-w-[45%] truncate font-medium text-dls-text">
                  {item.fileName}
                </span>
                {folderPath ? (
                  <span className="min-w-0 flex-1 truncate text-right text-dls-secondary" title={folderPath}>
                    {folderPath}
                  </span>
                ) : null}
                {item.content && item.startLine === 0 && item.endLine === 0 ? (
                  <span className="shrink-0 text-dls-secondary">{item.content}</span>
                ) : null}
                {lineLabel ? (
                  <span className="shrink-0 text-dls-accent">{lineLabel}</span>
                ) : null}
              </>
            );
            return item.isDirectory ? (
              <div
                key={`${item.path}:${index}`}
                className="flex min-h-8 items-center gap-2 px-1 py-1.5 text-left"
                title={item.path}
              >
                {content}
              </div>
            ) : (
              <Button
                key={`${item.path}:${index}`}
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto min-h-8 w-full justify-start gap-2 rounded-sm px-1 py-1.5 text-left font-normal hover:bg-dls-hover"
                title={item.path}
                disabled={!props.onOpenCodePath}
                onClick={() => props.onOpenCodePath?.(item.path)}
              >
                {content}
              </Button>
            );
          })}
        </div>
      ) : (
        <div className="px-1 py-2 text-dls-secondary">{t("session.tool_files_no_results")}</div>
      )}
      {props.details.omittedCount > 0 ? (
        <div className="px-1 py-2 text-dls-secondary">
          {t("session.tool_files_more_results", { count: props.details.omittedCount })}
        </div>
      ) : null}
    </div>
  );
}

function referenceExternalUrl(source: string, start: number | null, end: number | null) {
  if (!/^https?:\/\//i.test(source)) return null;
  if (start === null || start <= 0) return source;
  return `${source}#L${start}${end !== null && end > 0 ? `-L${end}` : ""}`;
}

function ReferenceResultItem(props: {
  reference: Extract<TranscriptSpecializedToolDetails, { kind: "references" }>["references"][number];
  index: number;
  onOpenCodePath?: (path: string) => void;
}) {
  const platform = usePlatform();
  const [expanded, setExpanded] = useState(false);
  const externalUrl = referenceExternalUrl(
    props.reference.source,
    props.reference.startPos,
    props.reference.endPos,
  );
  const canExpand = Boolean(props.reference.chunk && !externalUrl);
  const handleClick = () => {
    if (externalUrl) {
      platform.openLink(externalUrl);
      return;
    }
    if (canExpand) {
      setExpanded((value) => !value);
      return;
    }
    if (props.reference.source) props.onOpenCodePath?.(props.reference.source);
  };
  return (
    <div className="border-b border-dls-border last:border-b-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto min-h-8 w-full justify-start gap-2 rounded-none px-1 py-1.5 text-left font-normal hover:bg-dls-hover"
        title={props.reference.source}
        onClick={handleClick}
      >
        <span className="shrink-0 text-dls-secondary">{props.index + 1}.</span>
        <span className="min-w-0 shrink truncate font-medium text-dls-text">
          {props.reference.fileName || basenameForDisplay(props.reference.source)}
        </span>
        <span className="min-w-0 flex-1 truncate text-dls-secondary">
          {props.reference.source}
        </span>
        {externalUrl ? (
          <ExternalLink className="size-3.5 shrink-0 text-dls-secondary" aria-hidden="true" />
        ) : canExpand ? (
          <ChevronDown
            className={cn("size-3.5 shrink-0 transition-transform", !expanded && "-rotate-90")}
            aria-hidden="true"
          />
        ) : null}
      </Button>
      {expanded && props.reference.chunk ? (
        <pre className="m-0 max-h-[300px] overflow-auto whitespace-pre-wrap wrap-break-word bg-dls-surface-muted px-4 py-3 font-mono text-xs leading-5 text-dls-text">
          {props.reference.chunk}
        </pre>
      ) : null}
    </div>
  );
}

function ReferencesToolDetails(props: {
  details: Extract<TranscriptSpecializedToolDetails, { kind: "references" }>;
  onOpenCodePath?: (path: string) => void;
}) {
  return (
    <div data-tool-details="references" className="my-1 text-xs">
      <div className="mb-1 px-1 font-medium text-dls-secondary">
        {t(
          props.details.referenceType === "knowledge"
            ? "session.tool_references_knowledge"
            : "session.tool_references_codebase",
          { count: props.details.references.length },
        )}
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {props.details.references.map((reference, index) => (
          <ReferenceResultItem
            key={`${reference.source}:${index}`}
            reference={reference}
            index={index}
            onOpenCodePath={props.onOpenCodePath}
          />
        ))}
      </div>
    </div>
  );
}

export function SpecializedToolDetails(props: {
  details: TranscriptSpecializedToolDetails;
  onOpenCodePath?: (path: string) => void;
}) {
  const platform = usePlatform();
  const details = props.details;
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  if (details.kind === "compact-tool") {
    return (
      <div className="overflow-hidden rounded-lg bg-dls-surface-muted text-xs text-dls-text">
        {details.title ? (
          <div className="border-b border-dls-border px-4 py-2 font-medium">{details.title}</div>
        ) : null}
        {details.variant === "preview-url" && details.summary ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start gap-2 rounded-none px-4 py-2 font-normal text-dls-accent"
            onClick={() => platform.openLink(details.summary ?? "")}
          >
            <ExternalLink className="size-3.5 shrink-0" />
            <span className="truncate">{details.summary}</span>
          </Button>
        ) : details.summary ? (
          <div className="whitespace-pre-wrap wrap-break-word px-4 py-2 leading-5">{details.summary}</div>
        ) : null}
        {details.result && details.variant !== "memory" ? (
          <pre className="m-0 max-h-[300px] overflow-auto border-t border-dls-border px-4 py-3 font-mono leading-5 text-dls-secondary">
            {details.result}
          </pre>
        ) : null}
      </div>
    );
  }

  if (details.kind === "mcp") {
    const progressText = details.progress
      ? [
          details.progress.total === null
            ? `${details.progress.current}`
            : `${details.progress.current}/${details.progress.total}`,
          details.progress.message,
        ].filter(Boolean).join(" · ")
      : null;
    return (
      <div data-tool-details="mcp" className="overflow-hidden rounded-lg border border-dls-border bg-dls-surface text-xs">
        {progressText ? (
          <div className="inline-flex w-full items-center gap-2 border-b border-dls-border bg-dls-surface-muted px-3 py-2 text-dls-secondary">
            <LoadingSpinner className="size-3.5" />
            <span>{progressText}</span>
          </div>
        ) : null}
        {Object.keys(details.args).length > 0 ? (
          <div className="border-b border-dls-border px-3 py-2">
            <div className="mb-1 font-medium text-dls-secondary">{t("session.tool_mcp_parameters")}</div>
            <pre className="m-0 max-h-[240px] overflow-auto whitespace-pre-wrap font-mono leading-5 text-dls-text">
              {JSON.stringify(details.args, null, 2)}
            </pre>
          </div>
        ) : null}
        <div className="px-3 py-2">
          <div className="mb-1 font-medium text-dls-secondary">{t("session.tool_result")}</div>
          {details.errorMessage ? (
            <pre className="m-0 whitespace-pre-wrap font-mono leading-5 text-dls-status-danger-fg">{details.errorMessage}</pre>
          ) : details.content.length > 0 ? (
            <div className="max-h-[360px] space-y-2 overflow-auto">
              {details.content.map((item, index) => item.type === "image" ? (
                <McpImagePreview
                  key={`image:${index}`}
                  source={`data:${item.mimeType};base64,${item.data}`}
                  index={index}
                  onOpen={() => setPreviewImage(`data:${item.mimeType};base64,${item.data}`)}
                />
              ) : (
                <pre key={`${item.type}:${index}`} className="m-0 whitespace-pre-wrap wrap-break-word font-mono leading-5 text-dls-text">
                  {item.text}
                </pre>
              ))}
            </div>
          ) : (
            <span className="text-dls-secondary">{t("session.tool_no_result")}</span>
          )}
        </div>
        <Dialog open={previewImage !== null} onOpenChange={(open) => {
          if (!open) setPreviewImage(null);
        }}>
          <DialogContent className="bg-dls-surface p-3 sm:max-w-4xl" showCloseButton>
            <DialogTitle className="sr-only">{t("session.tool_mcp_image_preview")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("session.tool_mcp_image_preview_description")}
            </DialogDescription>
            {previewImage ? (
              <img
                src={previewImage}
                alt={t("session.tool_mcp_image_preview")}
                className="max-h-[82vh] w-full object-contain"
              />
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (details.kind === "mcp-resource") {
    return (
      <div className="overflow-hidden rounded-lg border border-dls-border bg-dls-surface text-xs">
        {details.uri ? (
          <div className="flex items-center gap-2 border-b border-dls-border px-3 py-2 font-mono text-dls-secondary">
            <Plug className="size-3.5 shrink-0" />
            <span className="truncate" title={details.uri}>{details.uri}</span>
          </div>
        ) : null}
        {details.presentation === "download" && details.downloadPath ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start gap-2 rounded-none border-b border-dls-border px-3 py-2 font-mono text-xs font-normal text-dls-secondary"
            onClick={() => void openDesktopPath(details.downloadPath ?? "")}
          >
            <File className="size-3.5 shrink-0" />
            <span className="truncate">{details.downloadPath}</span>
          </Button>
        ) : details.presentation === "http" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto w-full justify-start gap-2 rounded-none px-3 py-2 font-normal text-dls-accent"
            onClick={() => platform.openLink(details.uri)}
          >
            <ExternalLink className="size-3.5 shrink-0" />
            <span className="truncate">{details.uri}</span>
          </Button>
        ) : details.presentation === "image" ? (
          <img
            src={details.content}
            alt={t("session.tool_mcp_resource_image_alt")}
            className="max-h-[360px] max-w-full px-3 py-2 object-contain"
          />
        ) : (
          <pre className="m-0 max-h-[360px] overflow-auto whitespace-pre-wrap wrap-break-word px-3 py-2 font-mono leading-5 text-dls-text">
            {details.content || t("session.tool_no_result")}
          </pre>
        )}
      </div>
    );
  }

  if (details.kind === "skill") {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-dls-secondary">
        <Sparkles className="size-3.5" />
        {details.skillName}
      </div>
    );
  }

  if (details.kind === "completion") {
    return details.details ? (
      <div className="whitespace-pre-wrap rounded-lg border border-dls-border bg-dls-surface-muted px-3 py-2 text-xs leading-5 text-dls-secondary">
        {details.details}
      </div>
    ) : null;
  }

  if (details.kind === "open-result") return null;

  if (details.kind === "mcp-match") {
    return (
      <div className="overflow-hidden rounded-lg border border-dls-border bg-dls-surface text-xs">
        {details.requests.map((request, index) => (
          <div key={`${request.serverName}:${request.toolName}:${index}`} className="flex items-center gap-3 border-b border-dls-border px-3 py-2 last:border-b-0">
            <span className="min-w-0 flex-1 truncate text-dls-text">{request.toolName}</span>
            <span className="shrink-0 text-dls-secondary">{request.serverName}</span>
          </div>
        ))}
      </div>
    );
  }

  if (details.kind === "integration") {
    return (
      <div className="overflow-hidden rounded-lg border border-dls-border bg-dls-surface text-xs">
        {details.searchResults.map((result, index) => (
          <div key={`${result.integrationId}:${result.toolName}:${index}`} className="flex items-center gap-2 border-b border-dls-border px-3 py-2 last:border-b-0">
            <span className="font-medium text-dls-text">{result.integrationName}</span>
            <span className="text-dls-secondary">{result.toolName}</span>
          </div>
        ))}
        {details.result ? <pre className="m-0 whitespace-pre-wrap px-3 py-2 font-mono leading-5 text-dls-text">{details.result}</pre> : null}
        {details.hint ? <div className="border-t border-dls-border px-3 py-2 text-dls-secondary">{details.hint}</div> : null}
      </div>
    );
  }

  if (details.kind === "command") return <CommandToolDetails details={details} />;

  if (details.kind === "write") return <WriteToolDetails details={details} />;

  if (details.kind === "file-results") {
    return <FileResultsToolDetails details={details} onOpenCodePath={props.onOpenCodePath} />;
  }

  if (details.kind === "references") {
    return <ReferencesToolDetails details={details} onOpenCodePath={props.onOpenCodePath} />;
  }

  if (details.kind === "delete") return null;

  if (details.kind === "lint") {
    return (
      <div className="overflow-hidden rounded-lg border border-dls-border bg-dls-surface">
        <div className="border-b border-dls-border bg-dls-surface-muted px-3 py-2 text-xs font-medium text-dls-text">
          {details.pathText}
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {details.issues.map((issue, index) => (
            <div
              key={`${issue.message}:${issue.location ?? index}`}
              className="flex min-w-0 items-center gap-2 border-b border-dls-border px-3 py-2 text-xs last:border-b-0 hover:bg-dls-hover"
            >
              <CircleAlert className="size-4 shrink-0 text-dls-status-danger-fg" />
              <span className="min-w-0 flex-1 truncate text-dls-text" title={issue.message}>
                {issue.message}
              </span>
              {issue.location ? (
                <span className="shrink-0 font-mono text-2xs text-dls-secondary">
                  {issue.location}
                </span>
              ) : null}
            </div>
          ))}
          {details.omittedCount > 0 ? (
            <div className="px-3 py-2 text-xs text-dls-secondary">
              {t("session.tool_lint_more", { count: details.omittedCount })}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (details.kind === "web-search") {
    return (
      <div className="overflow-hidden rounded-xl bg-dls-surface-muted px-4 py-2">
        <div className="mb-1 text-xs font-medium text-dls-secondary">
          {t("session.tool_web_search_results", { count: details.results.length })}
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {details.results.length > 0 ? details.results.map((result, index) => (
            <Button
              key={`${result.url}:${index}`}
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto w-full justify-start gap-2 overflow-hidden px-0 py-1.5 text-left font-normal text-dls-secondary hover:bg-transparent hover:text-dls-text"
              title={result.snippet ?? result.site ?? result.url}
              disabled={!result.url}
              onClick={() => {
                if (result.url) platform.openLink(result.url);
              }}
            >
              {result.favicon ? (
                <img src={result.favicon} alt="" className="size-3.5 shrink-0 object-contain" />
              ) : (
                <Globe className="size-3.5 shrink-0" />
              )}
              <span className="min-w-0 truncate">{result.title}</span>
            </Button>
          )) : (
            <div className="py-2 text-xs text-dls-secondary">
              {t("session.tool_web_search_none")}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (details.kind === "web-fetch") {
    return (
      <div className="overflow-hidden rounded-lg border border-dls-border bg-dls-surface">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto w-full justify-start gap-2 rounded-none border-b border-dls-border px-3 py-2 font-normal text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
          disabled={!details.url}
          onClick={() => {
            if (details.url) platform.openLink(details.url);
          }}
        >
          {details.favicon ? (
            <img src={details.favicon} alt="" className="size-4 shrink-0 object-contain" />
          ) : (
            <Globe className="size-4 shrink-0" />
          )}
          <span className="min-w-0 truncate">{webLabel(details)}</span>
        </Button>
        {details.content ? (
          <div className="max-h-[360px] overflow-y-auto whitespace-pre-wrap wrap-break-word px-3 py-2 text-xs leading-5 text-dls-secondary">
            {details.content.slice(0, 2_000)}
          </div>
        ) : null}
      </div>
    );
  }

  if (details.kind === "plan") {
    const completed = details.todos.filter((item) => item.status === "completed").length;
    return (
      <div className="overflow-hidden rounded-lg border border-dls-border bg-dls-surface">
        <div className="flex items-center justify-between gap-3 border-b border-dls-border bg-dls-surface-muted px-3 py-2">
          <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-dls-text">
            <ListTodo className="size-4 shrink-0 text-dls-accent" />
            <span className="truncate">{details.name || t("session.tool_plan_title")}</span>
          </span>
          {details.todos.length > 0 ? (
            <StatusBadge size="tiny" shape="soft">
              {t("session.tool_plan_progress", { completed, total: details.todos.length })}
            </StatusBadge>
          ) : null}
        </div>
        {details.overview ? (
          <div className="border-b border-dls-border px-3 py-2 text-xs leading-5 text-dls-secondary">
            {details.overview}
          </div>
        ) : null}
        <div className="max-h-[300px] overflow-y-auto px-3 py-2">
          {details.todos.map((item, index) => (
            <div key={`${item.content}:${index}`} className="flex items-start gap-2 py-1 text-xs leading-5 text-dls-text">
              <TodoStatusIcon item={item} />
              <span className={cn(item.status === "completed" && "text-dls-secondary line-through")}>
                {item.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (details.kind === "image-gen") return null;

  return (
    <div className="overflow-hidden rounded-xl bg-dls-surface-muted px-4 py-3">
      {details.toolItems.length > 0 ? (
        <div className="max-h-[200px] overflow-y-auto pb-2">
          {details.toolItems.map((item, index) => (
            <div key={`${item.name}:${index}`} className="flex items-center gap-2 py-1 text-xs text-dls-secondary">
              <Network className="size-3.5 shrink-0" />
              <span className="font-medium text-dls-text">{item.name}</span>
              {item.summary ? <span className="min-w-0 truncate">{item.summary}</span> : null}
              {item.status ? <span className="ml-auto shrink-0">{item.status}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {details.finalResult ? (
        <div className="border-t border-dls-border pt-2 text-xs leading-5 text-dls-text first:border-t-0 first:pt-0">
          <div className="mb-1 inline-flex items-center gap-2 font-medium text-dls-secondary">
            <FileX2 className="size-3.5" />
            {t("session.tool_task_result")}
          </div>
          <div className="whitespace-pre-wrap wrap-break-word">{details.finalResult}</div>
        </div>
      ) : null}
    </div>
  );
}
