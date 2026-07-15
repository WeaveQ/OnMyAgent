/** @jsxImportSource react */
import { type CSSProperties } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  FileX2,
  Globe,
  Image as ImageIcon,
  ListTodo,
  LoaderCircle,
  Network,
} from "lucide-react";

import { openDesktopPath } from "../../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { usePlatform } from "../../../kernel/platform";
import type {
  TranscriptSpecializedToolDetails,
  TranscriptTodoItem,
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

export function specializedToolHeadline(
  details: TranscriptSpecializedToolDetails,
  running: boolean,
) {
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
  if (details.kind === "delete") return false;
  if (details.kind === "lint") return details.issues.length > 0;
  if (details.kind === "web-search") return details.results.length > 0;
  if (details.kind === "web-fetch") return Boolean(details.content);
  if (details.kind === "plan") return Boolean(details.name || details.overview || details.todos.length);
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

export function SpecializedToolDetails(props: {
  details: TranscriptSpecializedToolDetails;
}) {
  const platform = usePlatform();
  const details = props.details;

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
