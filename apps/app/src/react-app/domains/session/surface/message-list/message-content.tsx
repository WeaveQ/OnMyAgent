/** @jsxImportSource react */
/** Transcript content subcomponents: text, files, targets, turn body. */
import { useEffect, useRef, useState } from "react";
import {
  File as FileIcon,
  Globe,
  Terminal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MenuRowButton } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { currentLocale, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { isDesktopRuntime } from "../../../../../app/utils";
import { MarkdownBlock, type MarkdownVerifiedCodePath } from "../markdown";
import { applyTextHighlights } from "../text-highlights";
import {
  type TurnContentSegment,
  type TurnContentPresentation,
  type TurnFoldSegment,
  type TurnProcessItem,
} from "../transcript/turn-content";
import { InlineVisual } from "../transcript/inline-visual";
import type { OpenTarget } from "../../artifacts/open-target";
import type {
  SessionTranscriptDividerVariant,
} from "./types";
import {
  messageStateClass,
} from "./styles";
import {
  humanMediaType,
  isImageAttachment,
  openFileWithOS,
  resolveDisplayedPastedText,
  revealFileInFinder,
} from "./shared";
import { WorkBuddyProcessFold } from "./tool-block";

export function HighlightedPlainText(props: {
  text: string;
  className: string;
  highlightQuery?: string;
  /** Map of paste label -> full text for expandable chips */
  pastedTextMap?: Map<string, string>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const displayText = resolveDisplayedPastedText(
    props.text,
    props.pastedTextMap,
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    queueMicrotask(() => {
      if (!rootRef.current || rootRef.current !== root) return;
      applyTextHighlights(root, props.highlightQuery ?? "");
    });
  }, [displayText, props.highlightQuery]);

  return (
    <div ref={rootRef} className={props.className}>
      {displayText}
    </div>
  );
}

function parseExpandedSkillReference(text: string): { name: string; arguments: string } | null {
  const frontmatter = text.match(/^---\s*\r?\n[\s\S]*?\bname:\s*["']?([A-Za-z0-9][\w.-]*)["']?\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/);
  const name = frontmatter?.[1];
  if (!name) return null;

  const lines = text.trimEnd().split(/\r?\n/);
  const trailing: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      if (trailing.length > 0) break;
      continue;
    }
    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith(">") ||
      trimmed.startsWith("- ") ||
      trimmed.startsWith("* ") ||
      trimmed.startsWith("```") ||
      trimmed.startsWith("|") ||
      /^\d+\.\s/.test(trimmed)
    ) {
      break;
    }
    trailing.unshift(line);
  }

  const args = trailing.join("\n").trim();
  if (!args || args === text.trim()) return null;
  return { name, arguments: args };
}

function parseSkillReference(text: string): { name: string; arguments: string } | null {
  const markerMatch = text.match(/^\[\[skill:([A-Za-z0-9][\w.-]*)\]\]\s*([\s\S]*)$/);
  if (markerMatch?.[1]) {
    return { name: markerMatch[1], arguments: markerMatch[2] ?? "" };
  }

  const slashMatch = text.match(/^\/([A-Za-z0-9][\w.-]*)\s+([\s\S]*)$/);
  if (slashMatch?.[1]) {
    return { name: slashMatch[1], arguments: slashMatch[2] ?? "" };
  }

  return parseExpandedSkillReference(text);
}

export function SkillReferenceText(props: { text: string; highlightQuery?: string }) {
  const skillReference = parseSkillReference(props.text);
  if (!skillReference) {
    return (
      <HighlightedPlainText
        text={props.text}
        className="whitespace-pre-wrap wrap-break-word text-dls-text"
        highlightQuery={props.highlightQuery}
      />
    );
  }

  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 whitespace-pre-wrap wrap-break-word text-dls-text">
      <span className={messageStateClass.skillReferenceChip}>
        <Terminal size={12} aria-hidden="true" />
        /{skillReference.name}
      </span>
      <HighlightedPlainText
        text={skillReference.arguments}
        className="min-w-0 wrap-break-word"
        highlightQuery={props.highlightQuery}
      />
    </div>
  );
}

export function FileCard(props: {
  part: { filename?: string; url: string; mediaType: string };
  tone: "assistant" | "user";
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isDataUrl = props.part.url?.startsWith("data:");
  const title =
    props.part.filename ||
    (isDataUrl ? t("session.attached_file") : props.part.url) ||
    t("session.file");
  const ext = props.part.filename?.split(".").pop()?.toLowerCase();
  const badge = humanMediaType(props.part.mediaType) ?? (ext ? ext.toUpperCase() : null);
  const isImage = isImageAttachment(props.part.mediaType ?? "");
  const isDesktop = isDesktopRuntime();
  const hasPath = !isDataUrl && props.part.url && !props.part.url.startsWith("http");

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
        props.tone === "user"
          ? "border-dls-mist bg-dls-surface-muted hover:bg-dls-surface-muted"
          : "border-dls-mist bg-dls-surface hover:bg-dls-surface-muted",
      )}
    >
      {isImage && props.part.url ? (
        <div className="size-11 shrink-0 overflow-hidden rounded-xl border border-dls-mist bg-dls-surface">
          <img src={props.part.url} alt={title} loading="lazy" decoding="async" className="size-full object-cover" />
        </div>
      ) : (
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl",
            props.tone === "user" ? "bg-dls-surface-muted text-dls-text" : "bg-dls-surface-muted text-dls-secondary",
          )}
        >
          <FileIcon size={20} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium leading-snug text-dls-text">{title}</div>
        {badge ? (
          <StatusBadge className="mt-1" shape="soft" size="tiny">
            {badge}
          </StatusBadge>
        ) : null}
      </div>

      {isDesktop && hasPath ? (
        <div className="relative">
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className="text-dls-secondary opacity-0 hover:bg-dls-surface-muted hover:text-dls-text group-hover:opacity-100"
            onClick={() => setMenuOpen((value) => !value)}
            title={t("message.file_actions")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </Button>
          {menuOpen ? (
            <>
              <button type="button" className="fixed inset-0 z-30 cursor-default border-0 bg-transparent p-0" aria-label={t("message.close_file_actions")} onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-48 rounded-xl border border-dls-border bg-dls-surface p-1.5">
                <MenuRowButton align="center"
                  type="button"
                  className="gap-2.5 py-2 text-dls-text hover:bg-dls-surface-muted"
                  onClick={() => {
                    void openFileWithOS(props.part.url);
                    setMenuOpen(false);
                  }}
                >
                  {t("message.open_with_default_app")}
                </MenuRowButton>
                <MenuRowButton align="center"
                  type="button"
                  className="gap-2.5 py-2 text-dls-text hover:bg-dls-surface-muted"
                  onClick={() => {
                    void revealFileInFinder(props.part.url);
                    setMenuOpen(false);
                  }}
                >
                  {t("message.reveal_in_finder")}
                </MenuRowButton>
                <MenuRowButton align="center"
                  type="button"
                  className="gap-2.5 py-2 text-dls-text hover:bg-dls-surface-muted"
                  onClick={() => {
                    void navigator.clipboard.writeText(props.part.url);
                    setMenuOpen(false);
                  }}
                >
                  {t("message.copy_path")}
                </MenuRowButton>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}


export function OpenTargetIcon(props: { target: OpenTarget }) {
  if (props.target.kind === "url") {
    return <Globe size={12} className="shrink-0 text-dls-secondary" />;
  }

  if (props.target.preview === "sheet") {
    return (
      <StatusBadge size="fileType" className={messageStateClass.sheetBadge}>
        XLS
      </StatusBadge>
    );
  }
  if (props.target.preview === "markdown") {
    return (
      <StatusBadge size="fileType" className="border border-dls-border bg-dls-surface-muted text-dls-text">
        MD
      </StatusBadge>
    );
  }

  return <FileIcon size={12} className="shrink-0 text-dls-secondary" />;
}

export function OpenableTargetsStrip(props: { targets: OpenTarget[]; onOpenTarget: (target: OpenTarget) => void }) {
  if (!props.targets.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm leading-none">
      <span className="mr-0.5 text-dls-secondary">{t("session.openable_items")}</span>
      {props.targets.map((target) => (
          <Button
            key={target.id}
            type="button"
            variant="outline"
            size="xs"
            className="session-generated-artifact-card max-w-[220px] rounded-lg text-dls-text hover:text-dls-text"
            title={target.value}
            onClick={() => props.onOpenTarget(target)}
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

export function TranscriptDividerRow(props: {
  label: string;
  variant?: SessionTranscriptDividerVariant;
}) {
  return (
    <div
      className={cn(
        "session-transcript-divider mx-auto flex items-center justify-center gap-3 px-3 py-3 text-sm text-dls-secondary sm:px-5",
        props.variant && `session-transcript-divider-${props.variant}`,
      )}
      data-divider-variant={props.variant}
    >
      <div className="session-transcript-divider-line min-w-10 flex-1" />
      <span className="session-transcript-divider-label shrink-0">{props.label}</span>
      <div className="session-transcript-divider-line min-w-10 flex-1" />
    </div>
  );
}

export function WorkBuddyTurnContent(props: {
  presentation: TurnContentPresentation;
  detailsExpanded: boolean;
  expandedStepIds: Set<string>;
  onExpandedStepIdsChange: (updater: (current: Set<string>) => Set<string>) => void;
  onOpenCodePath?: (path: string) => void;
  highlightQuery?: string;
  verifiedCodePaths?: readonly MarkdownVerifiedCodePath[];
}) {
  const running = props.presentation.state === "streaming" ||
    props.presentation.state === "awaiting-approval";
  const showExpandedProcess = running || props.detailsExpanded ||
    props.presentation.state === "cancelled" || props.presentation.state === "failed";
  const lastBodyId = props.presentation.segments.findLast(
    (segment) => segment.kind === "body",
  )?.id;

  const renderProcess = (id: string, items: TurnProcessItem[]) => (
    <WorkBuddyProcessFold
      key={id}
      id={id}
      items={items}
      running={running}
      expandedStepIds={props.expandedStepIds}
      onExpandedStepIdsChange={props.onExpandedStepIdsChange}
      onOpenCodePath={props.onOpenCodePath}
    />
  );

  const renderExpandedSegment = (segment: TurnContentSegment) => {
    if (segment.kind === "process") return renderProcess(segment.id, segment.items);
    if (segment.kind === "file" && segment.item.part.type === "file") {
      return (
        <FileCard
          key={segment.id}
          part={{
            filename: segment.item.part.filename,
            url: segment.item.part.url,
            mediaType: segment.item.part.mediaType,
          }}
          tone="assistant"
        />
      );
    }
    if (segment.kind !== "body") return null;
    return (
      <div key={segment.id} className="session-workbuddy-turn-body">
        <MarkdownBlock
          text={segment.text}
          streaming={running && segment.id === lastBodyId}
          showStreamingCursor={false}
          highlightQuery={props.highlightQuery}
          locale={currentLocale()}
          onOpenCodePath={props.onOpenCodePath}
          verifiedCodePaths={props.verifiedCodePaths}
        />
      </div>
    );
  };

  const renderCollapsedSegment = (segment: TurnFoldSegment) => {
    if (segment.kind === "hidden") return null;
    if (segment.kind === "process") return renderProcess(segment.id, segment.items);
    return (
      <div key={segment.id} className="session-workbuddy-turn-body">
        <MarkdownBlock
          text={segment.text}
          highlightQuery={props.highlightQuery}
          locale={currentLocale()}
          onOpenCodePath={props.onOpenCodePath}
          verifiedCodePaths={props.verifiedCodePaths}
        />
      </div>
    );
  };

  return (
    <div className="session-workbuddy-turn-content" data-workbuddy-turn-content="true">
      {showExpandedProcess
        ? props.presentation.segments.map(renderExpandedSegment)
        : props.presentation.collapsedSegments.map(renderCollapsedSegment)}
      {props.presentation.hoistedItems.map((visual) => (
        <InlineVisual
          key={`${visual.messageId}:${visual.partIndex}:${visual.toolName}`}
          visual={visual}
        />
      ))}
    </div>
  );
}

