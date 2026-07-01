/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BarChart3, Ellipsis, FolderOpen, GitBranch, KeyRound, MessageSquareText, Pin, RefreshCw, RotateCcw, Settings, Star, Terminal, Trash2, UploadCloud } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Button } from "@/components/ui/button";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandDialogTitle,
  CommandEmpty,
  CommandFooter,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { t } from "../../../../i18n";
import {
  formatSessionArchiveBytes,
  formatSessionArchiveCost,
  formatSessionArchiveDuration,
  formatSessionArchiveNumber,
  formatSessionArchivePercent,
  type SessionArchiveAnalyticsState,
  type SessionArchiveCommandItem,
  type SessionArchiveImportKind,
  type SessionArchiveSessionGroup,
  type SessionArchiveSessionTreeItem,
} from "./session-page-session-archive-model";
import { cn } from "@/lib/utils";
import type {
  OpenworkSessionArchiveBackendsStatusResponse,
  OpenworkSessionArchiveConfigSnapshot,
  OpenworkSessionArchiveLifecycleStatus,
  OpenworkSessionArchiveMessagesResponse,
  OpenworkSessionArchivePinnedMessage,
  OpenworkSessionArchiveSecretConfidence,
  OpenworkSessionArchiveSecretFinding,
  OpenworkSessionArchiveSecretScanSummary,
  OpenworkSessionArchiveSession,
  OpenworkSessionArchiveSessionUsage,
  OpenworkSessionArchiveTopUsageSession,
  OpenworkSessionArchiveUsageComparison,
  OpenworkSessionArchiveUsageSummaryResponse,
  OpenworkSessionArchiveWorktreeMapping,
} from "../../../../app/lib/onmyagent-server";

type SessionArchiveSessionListRow =
  | { kind: "group"; label: string; count: number }
  | { kind: "session"; item: SessionArchiveSessionTreeItem };

export function PathSummary(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-dls-border bg-dls-muted px-3 py-2">
      <div className="text-xs text-dls-secondary">{props.label}</div>
      <div className="mt-1 break-all font-mono text-xs text-dls-text">{props.value}</div>
    </div>
  );
}

export function SegmentedRow<T extends string>(props: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div className="flex flex-wrap rounded-lg border border-dls-border bg-dls-surface p-0.5">
      {props.options.map((option) => (
        <Button key={option.value} type="button" variant={props.value === option.value ? "secondary" : "ghost"} size="sm" onClick={() => props.onChange(option.value)}>
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function LabeledInput(props: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block space-y-1 text-xs text-dls-secondary">
      <span>{props.label}</span>
      <InputGroup radius="lg">
        <InputGroupInput type={props.type ?? "text"} value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)} />
      </InputGroup>
    </label>
  );
}

export function LabeledTextArea(props: { label: string; value: string; onChange: (value: string) => void; rows: number }) {
  return (
    <label className="block space-y-1 text-xs text-dls-secondary">
      <span>{props.label}</span>
      <Textarea
        variant="dlsMono"
        className="resize-y leading-5"
        rows={props.rows}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </label>
  );
}

export function CheckboxRow(props: { checked: boolean; onCheckedChange: (value: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-dls-text">
      <Checkbox checked={props.checked} onCheckedChange={(value) => props.onCheckedChange(value === true)} />
      {props.label}
    </label>
  );
}

export function SelectField(props: { value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; contentClassName?: string }) {
  return (
    <Select
      value={props.value}
      items={props.options}
      onValueChange={(value) => {
        if (value) props.onChange(value);
      }}
    >
      <SelectTrigger size="sm" className="h-9 w-full rounded-lg border-dls-border bg-dls-surface px-3 text-sm text-dls-text">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger className={props.contentClassName}>
        <SelectGroup>
          {props.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function UsageMetric(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-dls-border bg-dls-surface p-3">
      <div className="text-xs text-dls-secondary">{props.label}</div>
      <div className="mt-1 truncate text-sm font-medium text-dls-text">{props.value}</div>
    </div>
  );
}

function MetricBand(props: { children: ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{props.children}</div>;
}

function ArchivePanelSection(props: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-dls-border bg-dls-surface p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-dls-text">{props.title}</h3>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

export function UsageList(props: { title: string; items: { label: string; value: string }[] }) {
  return (
    <section className="rounded-lg border border-dls-border bg-dls-surface p-4">
      <h3 className="mb-3 text-sm font-medium text-dls-text">{props.title}</h3>
      {props.items.length > 0 ? (
        <div className="space-y-2">
          {props.items.slice(0, 8).map((item, index) => (
            <div key={`${props.title}:${index}:${item.label}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-dls-text">{item.label}</span>
              <span className="shrink-0 text-xs text-dls-secondary">{item.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-dls-secondary">{t("session_archive.no_usage")}</div>
      )}
    </section>
  );
}

export function ArchiveStateBlock(props: { title: string; description?: string; tone?: "info" | "warning" | "error" }) {
  return (
    <NoticeBox tone={props.tone ?? "info"} size="default" className="flex h-full min-h-40 items-center justify-center text-center">
      <div className="space-y-1">
        <div className="text-sm font-medium text-dls-text">{props.title}</div>
        {props.description ? <div className="text-xs text-dls-secondary">{props.description}</div> : null}
      </div>
    </NoticeBox>
  );
}

export function SessionArchiveCommandPalette(props: {
  open: boolean;
  items: SessionArchiveCommandItem[];
  onClose: () => void;
}) {
  return (
    <CommandDialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <CommandDialogPopup onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }
      }}>
        <CommandDialogTitle>{t("session_archive.command_palette_title")}</CommandDialogTitle>
        <Command items={props.items}>
          <CommandHeader>
            <CommandInput placeholder={t("session_archive.command_palette_placeholder")} />
          </CommandHeader>
          <CommandPanel>
            <CommandEmpty>{t("session.palette_no_matches")}</CommandEmpty>
            <CommandList>
              {(item: SessionArchiveCommandItem) => (
                <CommandItem key={item.id} value={item.id} onClick={item.action}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.title}</div>
                    {item.detail ? <div className="truncate text-xs text-muted-foreground">{item.detail}</div> : null}
                    {item.searchText ? <span className="sr-only">{item.searchText}</span> : null}
                  </div>
                  {item.meta ? <CommandShortcut>{item.meta}</CommandShortcut> : null}
                </CommandItem>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <span>{t("session.palette_hint_navigate")}</span>
            <span>{t("session.palette_hint_run")}</span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

export function VirtualSessionList(props: {
  groups: SessionArchiveSessionGroup[];
  showGroupHeaders?: boolean;
  selectedSessionId: string | null;
  starredIds: string[];
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (session: OpenworkSessionArchiveSession) => void;
  onOpenSessionDirectory: (sessionId: string) => void;
  onTrashSession: (session: OpenworkSessionArchiveSession) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo<SessionArchiveSessionListRow[]>(() => props.groups.flatMap((group) => (
    props.showGroupHeaders === false
      ? group.treeItems.map((item) => ({ kind: "session" as const, item }))
      : [{ kind: "group" as const, label: group.label, count: group.sessions.length }, ...group.treeItems.map((item) => ({ kind: "session" as const, item }))]
  )), [props.groups, props.showGroupHeaders]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => rows[index]?.kind === "group" ? 30 : 64,
    overscan: 8,
    getItemKey: (index) => {
      const row = rows[index];
      if (!row) return index;
      return row.kind === "group" ? `group:${row.label}` : `session:${row.item.session.id}`;
    },
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto" data-session-archive-virtual-session-list="true">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
              data-index={item.index}
            >
              {row.kind === "group" ? (
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-dls-border/60 bg-dls-surface px-3 py-1.5 text-xs text-dls-secondary">
                  <span className="font-medium uppercase text-dls-text">{row.label}</span>
                  <span>{t("session_archive.agent_group_count", { count: row.count })}</span>
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  data-session-archive-session-agent={row.item.session.agent}
                  data-session-archive-session-id={row.item.session.id}
                  className={cn(
                    "cursor-pointer",
                    "flex w-full flex-col gap-1 border-b border-dls-border/60 px-3 py-2 text-left text-sm hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
                    props.selectedSessionId === row.item.session.id && "bg-dls-list-selected border-l-2 border-l-dls-accent pl-2.5",
                  )}
                  style={{ paddingLeft: `${12 + row.item.depth * 16}px` }}
                  onClick={() => props.onSelectSession(row.item.session.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    props.onSelectSession(row.item.session.id);
                  }}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <MessageSquareText className="size-3.5 shrink-0 text-dls-secondary" />
                    <span className="truncate font-medium text-dls-text">{row.item.session.display_name || row.item.session.first_message || row.item.session.id}</span>
                    {row.item.childCount > 0 ? <StatusBadge tone="neutral">{row.item.childCount}</StatusBadge> : null}
                    {row.item.relationshipType ? <StatusBadge tone={row.item.relationshipType === "subagent" ? "accent" : "neutral"}>{row.item.relationshipType}</StatusBadge> : null}
                    {row.item.session.is_teammate ? <StatusBadge tone="accent">team</StatusBadge> : null}
                    {props.starredIds.includes(row.item.session.id) ? <Star className="size-3.5 shrink-0 fill-dls-accent text-dls-accent" /> : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" onClick={(event) => event.stopPropagation()} />}>
                        <Ellipsis className="size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={(event) => { event.stopPropagation(); props.onRenameSession(row.item.session); }}>
                          {t("session_archive.rename")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(event) => { event.stopPropagation(); props.onOpenSessionDirectory(row.item.session.id); }}>
                          {t("session_archive.open_directory")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={(event) => { event.stopPropagation(); props.onTrashSession(row.item.session); }}>
                          {t("session_archive.trash_action")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-dls-secondary">
                    <span className="min-w-0 truncate">{row.item.session.project}</span>
                    <span className="shrink-0">{t("session_archive.message_count", { count: row.item.session.message_count })}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TrashSessionList(props: {
  groups: SessionArchiveSessionGroup[];
  visibleGroups: SessionArchiveSessionGroup[];
  totalCount: number;
  selectedAgent: string | null;
  onSelectAgent: (agent: string | null) => void;
  onRestore: (sessionId: string) => void;
  onDelete: (session: OpenworkSessionArchiveSession) => void;
  onEmptyTrash: () => void;
}) {
  if (props.totalCount === 0) {
    return (
      <div className="space-y-2 px-4 py-6 text-sm text-dls-secondary">
        <div className="font-medium text-dls-text">{t("session_archive.trash_empty")}</div>
        <p>{t("session_archive.trash_help")}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase text-dls-secondary">{t("session_archive.trash")}</div>
          <p className="text-xs leading-5 text-dls-secondary">{t("session_archive.trash_help")}</p>
        </div>
        <Button type="button" variant="destructive" size="sm" onClick={props.onEmptyTrash}>
          <Trash2 className="size-3.5" />
          {t("session_archive.empty_trash")}
        </Button>
      </div>
      <div className="space-y-2" data-session-archive-trash-agent-filter="root">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium uppercase text-dls-secondary">{t("session_archive.agent_filter_title")}</div>
          <span className="text-xs text-dls-secondary">{t("session_archive.trash_count", { count: props.totalCount })}</span>
        </div>
        <div className="max-h-32 overflow-y-auto rounded-lg border border-dls-border bg-dls-muted p-1">
          <div className="grid grid-cols-2 gap-1">
            <Button
              type="button"
              variant={props.selectedAgent ? "ghost" : "secondary"}
              size="sm"
              className="w-full justify-between gap-2 px-2"
              data-session-archive-trash-agent-filter-option="__all__"
              onClick={() => props.onSelectAgent(null)}
            >
              <span className="min-w-0 truncate">{t("session_archive.agent_filter_all")}</span>
              <span className="shrink-0 text-xs text-dls-secondary">{props.totalCount}</span>
            </Button>
            {props.groups.map((group) => (
              <Button
                key={group.label}
                type="button"
                variant={props.selectedAgent === group.label ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-between gap-2 px-2"
                data-session-archive-trash-agent-filter-option={group.label}
                title={group.label}
                onClick={() => props.onSelectAgent(group.label)}
              >
                <span className="min-w-0 truncate">{group.label}</span>
                <span className="shrink-0 text-xs text-dls-secondary">{group.sessions.length}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {props.visibleGroups.map((group) => (
            <div key={group.label} className="space-y-2">
              <div className="flex items-center justify-between border-b border-dls-border/60 px-1 py-1 text-xs text-dls-secondary">
              <span className="font-medium uppercase text-dls-text">{group.label}</span>
              <span>{t("session_archive.trash_count", { count: group.sessions.length })}</span>
            </div>
            {group.sessions.map((session) => (
              <div
                key={session.id}
                className="rounded-lg border border-dls-border bg-dls-muted p-2 text-xs"
                data-session-archive-trash-session-agent={session.agent}
                data-session-archive-trash-session-id={session.id}
              >
                <div className="truncate font-medium text-dls-text">{session.display_name || session.first_message || session.id}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-dls-secondary">
                  <span>{session.project}</span>
                  <span>{t("session_archive.message_count", { count: session.message_count })}</span>
                </div>
                <div className="mt-2 flex gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => props.onRestore(session.id)}>
                    <RotateCcw className="size-3.5" />
                    {t("session_archive.restore")}
                  </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => props.onDelete(session)}>
                    <Trash2 className="size-3.5" />
                    {t("session_archive.delete_permanent")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function VirtualMessageList(props: {
  messages: OpenworkSessionArchiveMessagesResponse["messages"];
  pins: OpenworkSessionArchivePinnedMessage[];
  onTogglePin: (sessionId: string, messageId: number, pinned: boolean) => void;
  findQuery?: string;
  activeFindOrdinal?: number | null;
  compact?: boolean;
  hideMeta?: boolean;
  followLatestSignal?: number;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: props.messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 136,
    overscan: 6,
    getItemKey: (index) => {
      const message = props.messages[index];
      return message ? `${message.session_id}:${message.ordinal}` : index;
    },
  });
  const activeIndex = props.activeFindOrdinal == null
    ? -1
    : props.messages.findIndex((message) => message.ordinal === props.activeFindOrdinal);

  useEffect(() => {
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: "center" });
  }, [activeIndex, virtualizer]);

  useEffect(() => {
    if (!props.followLatestSignal || props.messages.length === 0) return;
    virtualizer.scrollToIndex(props.messages.length - 1, { align: "end" });
  }, [props.followLatestSignal, props.messages.length, virtualizer]);

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-auto pr-1" data-session-archive-virtual-message-list="true">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const message = props.messages[item.index];
          if (!message) return null;
          const pinned = props.pins.some((pin) => pin.session_id === message.session_id && pin.message_id === message.ordinal);
          const activeFindMatch = props.activeFindOrdinal === message.ordinal;
          return (
            <article
              key={item.key}
              ref={virtualizer.measureElement}
              className={cn("absolute left-0 top-0 w-full rounded-lg border border-dls-border bg-dls-surface px-4", props.compact ? "py-2" : "py-3", activeFindMatch && "border-dls-accent bg-dls-accent/10")}
              style={{ transform: `translateY(${item.start}px)` }}
              data-index={item.index}
            >
              {!props.hideMeta ? (
                <div className="mb-2 flex items-center justify-between gap-3 text-xs text-dls-secondary">
                  <span className="font-medium text-dls-text">{message.role}</span>
                  <div className="flex items-center gap-2">
                    <span>{message.timestamp}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={pinned ? t("session_archive.unpin") : t("session_archive.pin")}
                      onClick={() => props.onTogglePin(message.session_id, message.ordinal, pinned)}
                    >
                      <Pin className={cn("size-3.5", pinned && "fill-dls-accent text-dls-accent")} />
                    </Button>
                  </div>
                </div>
              ) : null}
              <p className={cn("whitespace-pre-wrap text-sm text-dls-text", props.compact ? "leading-5" : "leading-6")}>{highlightMessageContent(message.content, props.findQuery ?? "")}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function highlightMessageContent(content: string, query: string): ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return content;
  const lowerContent = content.toLocaleLowerCase();
  const lowerQuery = trimmed.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = lowerContent.indexOf(lowerQuery);
  while (index >= 0) {
    if (index > cursor) parts.push(content.slice(cursor, index));
    const end = index + trimmed.length;
    parts.push(<mark key={`${index}:${end}`} className="rounded bg-dls-status-warning/12 px-0.5 text-dls-text">{content.slice(index, end)}</mark>);
    cursor = end;
    index = lowerContent.indexOf(lowerQuery, Math.max(end, index + 1));
  }
  if (cursor < content.length) parts.push(content.slice(cursor));
  return parts.length ? parts : content;
}

type SessionArchiveSettingsSection = "sources" | "runtime" | "security" | "storage";

export function SettingsPanel(props: {
  config: OpenworkSessionArchiveConfigSnapshot | null;
  loading: boolean;
  importKind: SessionArchiveImportKind;
  importFilename: string;
  importProject: string;
  importAgent: string;
  importContent: string;
  importing: boolean;
  selectedAgentDirId: string;
  agentDirText: string;
  terminalMode: OpenworkSessionArchiveConfigSnapshot["terminal"]["mode"];
  terminalBin: string;
  terminalArgs: string;
  githubToken: string;
  remoteUrl: string;
  remoteOriginsText: string;
  remoteRequireAuth: boolean;
  remoteAuthConfigured: boolean;
  postgresUrl: string;
  postgresSchema: string;
  postgresMachine: string;
  postgresAllowInsecure: boolean;
  postgresWatch: boolean;
  duckDbPath: string;
  duckDbUrl: string;
  duckDbTokenConfigured: boolean;
  duckDbMachine: string;
  duckDbAllowInsecure: boolean;
  backendsStatus: OpenworkSessionArchiveBackendsStatusResponse | null;
  lifecycleStatus: OpenworkSessionArchiveLifecycleStatus | null;
  mappingPath: string;
  mappingProject: string;
  mappingMachine: string;
  secretConfidence: OpenworkSessionArchiveSecretConfidence;
  secretFindings: OpenworkSessionArchiveSecretFinding[];
  secretScanSummary: OpenworkSessionArchiveSecretScanSummary | null;
  secretScanning: boolean;
  onImportKindChange: (value: SessionArchiveImportKind) => void;
  onImportFilenameChange: (value: string) => void;
  onImportProjectChange: (value: string) => void;
  onImportAgentChange: (value: string) => void;
  onImportContentChange: (value: string) => void;
  onImport: () => void;
  onSelectAgentDir: (agent: string) => void;
  onAgentDirTextChange: (value: string) => void;
  onSaveAgentDirs: () => void;
  onTerminalModeChange: (value: OpenworkSessionArchiveConfigSnapshot["terminal"]["mode"]) => void;
  onTerminalBinChange: (value: string) => void;
  onTerminalArgsChange: (value: string) => void;
  onSaveTerminal: () => void;
  onGithubTokenChange: (value: string) => void;
  onSaveGithub: () => void;
  onRemoteUrlChange: (value: string) => void;
  onRemoteOriginsTextChange: (value: string) => void;
  onRemoteRequireAuthChange: (value: boolean) => void;
  onRemoteAuthConfiguredChange: (value: boolean) => void;
  onSaveRemote: () => void;
  onPostgresUrlChange: (value: string) => void;
  onPostgresSchemaChange: (value: string) => void;
  onPostgresMachineChange: (value: string) => void;
  onPostgresAllowInsecureChange: (value: boolean) => void;
  onPostgresWatchChange: (value: boolean) => void;
  onSavePostgres: () => void;
  onDuckDbPathChange: (value: string) => void;
  onDuckDbUrlChange: (value: string) => void;
  onDuckDbTokenConfiguredChange: (value: boolean) => void;
  onDuckDbMachineChange: (value: string) => void;
  onDuckDbAllowInsecureChange: (value: boolean) => void;
  onSaveDuckDb: () => void;
  onMappingPathChange: (value: string) => void;
  onMappingProjectChange: (value: string) => void;
  onMappingMachineChange: (value: string) => void;
  onAddMapping: () => void;
  onDeleteMapping: (mappingId: string) => void;
  onApplyMappings: () => void;
  onSecretConfidenceChange: (value: OpenworkSessionArchiveSecretConfidence) => void;
  onScanSecrets: () => void;
}) {
  const selectedAgentDir = props.config?.agent_dirs.find((item) => item.agent === props.selectedAgentDirId) ?? null;
  const [section, setSection] = useState<SessionArchiveSettingsSection>("sources");
  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-4">
      <div className="lg:col-span-2 flex items-center justify-between gap-3 border-b border-dls-border pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-medium text-dls-text">{t("session_archive.settings_title")}</h2>
          <p className="mt-1 text-sm text-dls-secondary">{t("session_archive.settings_description")}</p>
        </div>
        {props.loading ? <StatusBadge tone="neutral">{t("session_archive.loading")}</StatusBadge> : null}
      </div>

      <nav className="flex gap-1 overflow-x-auto rounded-lg border border-dls-border bg-dls-muted p-1 lg:flex-col lg:overflow-visible" aria-label={t("session_archive.settings_title")}>
        {[
          { value: "sources" as const, label: t("session_archive.import_title") },
          { value: "runtime" as const, label: t("session_archive.terminal_title") },
          { value: "security" as const, label: t("session_archive.secrets_title") },
          { value: "storage" as const, label: t("session_archive.postgres_title") },
        ].map((item) => (
          <Button key={item.value} type="button" variant={section === item.value ? "secondary" : "ghost"} size="sm" className="justify-start" onClick={() => setSection(item.value)}>
            {item.label}
          </Button>
        ))}
      </nav>

      <div className="min-w-0 space-y-4 lg:col-span-3">

      {section === "sources" ? <section className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-dls-border bg-dls-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <UploadCloud className="size-4 text-dls-secondary" />
            <h3 className="text-sm font-medium text-dls-text">{t("session_archive.import_title")}</h3>
          </div>
          <div className="space-y-3">
            <SegmentedRow
              value={props.importKind}
              options={[
                { value: "upload", label: t("session_archive.import_upload") },
                { value: "claude-ai", label: t("session_archive.import_claude_ai") },
                { value: "chatgpt", label: t("session_archive.import_chatgpt") },
              ]}
              onChange={props.onImportKindChange}
            />
            <div className="grid gap-2 sm:grid-cols-3">
              <LabeledInput label={t("session_archive.import_filename")} value={props.importFilename} onChange={props.onImportFilenameChange} />
              <LabeledInput label={t("session_archive.import_project")} value={props.importProject} onChange={props.onImportProjectChange} />
              <LabeledInput label={t("session_archive.import_agent")} value={props.importAgent} onChange={props.onImportAgentChange} />
            </div>
            <LabeledTextArea label={t("session_archive.import_content")} value={props.importContent} onChange={props.onImportContentChange} rows={7} />
            <Button type="button" variant="outline" size="sm" onClick={props.onImport} disabled={props.importing || !props.importFilename.trim() || !props.importContent.trim()}>
              <UploadCloud className="size-4" />
              {props.importing ? t("session_archive.importing") : t("session_archive.import_action")}
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-dls-border bg-dls-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <FolderOpen className="size-4 text-dls-secondary" />
            <h3 className="text-sm font-medium text-dls-text">{t("session_archive.agent_dirs_title")}</h3>
          </div>
          <div className="space-y-3">
            <SelectField
              value={props.selectedAgentDirId}
              options={(props.config?.agent_dirs ?? []).map((item) => ({ value: item.agent, label: item.display_name }))}
              onChange={props.onSelectAgentDir}
            />
            <div className="flex flex-wrap gap-2 text-xs text-dls-secondary">
              <StatusBadge tone={selectedAgentDir?.configured ? "success" : "neutral"}>{selectedAgentDir?.source ?? t("common.unknown")}</StatusBadge>
              <span>{t("session_archive.agent_dirs_count", { count: selectedAgentDir?.dirs.length ?? 0 })}</span>
            </div>
            <LabeledTextArea label={t("session_archive.agent_dirs_paths")} value={props.agentDirText} onChange={props.onAgentDirTextChange} rows={6} />
            <Button type="button" variant="outline" size="sm" onClick={props.onSaveAgentDirs} disabled={!selectedAgentDir}>
              <FolderOpen className="size-4" />
              {t("session_archive.save_agent_dirs")}
            </Button>
          </div>
        </section>
      </section> : null}

      {section === "runtime" ? <section className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-dls-border bg-dls-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <Terminal className="size-4 text-dls-secondary" />
            <h3 className="text-sm font-medium text-dls-text">{t("session_archive.terminal_title")}</h3>
          </div>
          <div className="space-y-3">
            <SegmentedRow
              value={props.terminalMode}
              options={[
                { value: "auto", label: t("session_archive.terminal_auto") },
                { value: "custom", label: t("session_archive.terminal_custom") },
                { value: "clipboard", label: t("session_archive.terminal_clipboard") },
              ]}
              onChange={props.onTerminalModeChange}
            />
            <LabeledInput label={t("session_archive.terminal_bin")} value={props.terminalBin} onChange={props.onTerminalBinChange} />
            <LabeledInput label={t("session_archive.terminal_args")} value={props.terminalArgs} onChange={props.onTerminalArgsChange} />
            <Button type="button" variant="outline" size="sm" onClick={props.onSaveTerminal}>
              <Terminal className="size-4" />
              {t("session_archive.save_terminal")}
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-dls-border bg-dls-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="size-4 text-dls-secondary" />
            <h3 className="text-sm font-medium text-dls-text">{t("session_archive.github_title")}</h3>
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs text-dls-secondary">
              <StatusBadge tone={props.config?.github.configured ? "success" : "neutral"}>
                {props.config?.github.configured ? t("session_archive.github_configured") : t("session_archive.github_not_configured")}
              </StatusBadge>
              {props.config?.github.token_preview ? <span>{props.config.github.token_preview}</span> : null}
            </div>
            <LabeledInput label={t("session_archive.github_token")} value={props.githubToken} onChange={props.onGithubTokenChange} type="password" />
            <Button type="button" variant="outline" size="sm" onClick={props.onSaveGithub} disabled={!props.githubToken.trim()}>
              <KeyRound className="size-4" />
              {t("session_archive.save_github")}
            </Button>
          </div>
        </section>
      </section> : null}

      {section === "runtime" ? <section className="rounded-lg border border-dls-border bg-dls-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <GitBranch className="size-4 text-dls-secondary" />
          <h3 className="text-sm font-medium text-dls-text">{t("session_archive.worktree_title")}</h3>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <LabeledInput label={t("session_archive.worktree_prefix")} value={props.mappingPath} onChange={props.onMappingPathChange} />
          <LabeledInput label={t("session_archive.worktree_project")} value={props.mappingProject} onChange={props.onMappingProjectChange} />
          <LabeledInput label={t("session_archive.worktree_machine")} value={props.mappingMachine} onChange={props.onMappingMachineChange} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={props.onAddMapping} disabled={!props.mappingPath.trim() || !props.mappingProject.trim()}>
            <GitBranch className="size-4" />
            {t("session_archive.add_mapping")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={props.onApplyMappings} disabled={(props.config?.worktree_mappings ?? []).length === 0}>
            <RefreshCw className="size-4" />
            {t("session_archive.apply_mappings")}
          </Button>
        </div>
        <MappingList mappings={props.config?.worktree_mappings ?? []} onDelete={props.onDeleteMapping} />
      </section> : null}

      {section === "security" ? <section className="rounded-lg border border-dls-border bg-dls-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-dls-secondary" />
            <h3 className="text-sm font-medium text-dls-text">{t("session_archive.secrets_title")}</h3>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={props.onScanSecrets} disabled={props.secretScanning}>
            <RefreshCw className={cn("size-4", props.secretScanning && "animate-spin")} />
            {props.secretScanning ? t("session_archive.secrets_scanning") : t("session_archive.secrets_scan")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedRow
            value={props.secretConfidence}
            options={[
              { value: "definite", label: t("session_archive.secrets_definite") },
              { value: "candidate", label: t("session_archive.secrets_candidate") },
              { value: "all", label: t("session_archive.secrets_all") },
            ]}
            onChange={props.onSecretConfidenceChange}
          />
          {props.secretScanSummary ? (
            <StatusBadge tone={props.secretScanSummary.total_findings > 0 ? "warning" : "success"}>
              {t("session_archive.secrets_summary", {
                scanned: props.secretScanSummary.scanned,
                definite: props.secretScanSummary.definite_findings,
                candidate: props.secretScanSummary.candidate_findings,
              })}
            </StatusBadge>
          ) : null}
        </div>
        <SecretFindingList findings={props.secretFindings} />
      </section> : null}

      {section === "storage" ? <section className="rounded-lg border border-dls-border bg-dls-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <Settings className="size-4 text-dls-secondary" />
          <h3 className="text-sm font-medium text-dls-text">{t("session_archive.remote_title")}</h3>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <LabeledInput label={t("session_archive.remote_public_url")} value={props.remoteUrl} onChange={props.onRemoteUrlChange} />
          <LabeledTextArea label={t("session_archive.remote_origins")} value={props.remoteOriginsText} onChange={props.onRemoteOriginsTextChange} rows={4} />
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-dls-text">
          <CheckboxRow checked={props.remoteRequireAuth} onCheckedChange={props.onRemoteRequireAuthChange} label={t("session_archive.remote_require_auth")} />
          <CheckboxRow checked={props.remoteAuthConfigured} onCheckedChange={props.onRemoteAuthConfiguredChange} label={t("session_archive.remote_auth_configured")} />
        </div>
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={props.onSaveRemote}>
          <Settings className="size-4" />
          {t("session_archive.save_remote")}
        </Button>
      </section> : null}

      {section === "storage" ? <section className="grid gap-4 lg:grid-cols-2">
        <BackendConfigPanel
          title={t("session_archive.postgres_title")}
          status={props.backendsStatus?.backends.find((backend) => backend.backend === "postgres") ?? null}
          configuredPreview={props.config?.postgres.url_preview}
        >
          <LabeledInput label={t("session_archive.postgres_url")} value={props.postgresUrl} onChange={props.onPostgresUrlChange} type="password" />
          <div className="grid gap-3 md:grid-cols-2">
            <LabeledInput label={t("session_archive.postgres_schema")} value={props.postgresSchema} onChange={props.onPostgresSchemaChange} />
            <LabeledInput label={t("session_archive.postgres_machine")} value={props.postgresMachine} onChange={props.onPostgresMachineChange} />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-dls-text">
            <CheckboxRow checked={props.postgresAllowInsecure} onCheckedChange={props.onPostgresAllowInsecureChange} label={t("session_archive.backend_allow_insecure")} />
            <CheckboxRow checked={props.postgresWatch} onCheckedChange={props.onPostgresWatchChange} label={t("session_archive.postgres_watch")} />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={props.onSavePostgres}>
            <Settings className="size-4" />
            {t("session_archive.save_postgres")}
          </Button>
        </BackendConfigPanel>

        <BackendConfigPanel
          title={t("session_archive.duckdb_title")}
          status={props.backendsStatus?.backends.find((backend) => backend.backend === "duckdb") ?? null}
          configuredPreview={props.config?.duckdb.url_preview ?? props.config?.duckdb.path}
        >
          <LabeledInput label={t("session_archive.duckdb_path")} value={props.duckDbPath} onChange={props.onDuckDbPathChange} />
          <LabeledInput label={t("session_archive.duckdb_url")} value={props.duckDbUrl} onChange={props.onDuckDbUrlChange} type="password" />
          <LabeledInput label={t("session_archive.duckdb_machine")} value={props.duckDbMachine} onChange={props.onDuckDbMachineChange} />
          <div className="flex flex-wrap gap-4 text-sm text-dls-text">
            <CheckboxRow checked={props.duckDbTokenConfigured} onCheckedChange={props.onDuckDbTokenConfiguredChange} label={t("session_archive.duckdb_token_configured")} />
            <CheckboxRow checked={props.duckDbAllowInsecure} onCheckedChange={props.onDuckDbAllowInsecureChange} label={t("session_archive.backend_allow_insecure")} />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={props.onSaveDuckDb}>
            <Settings className="size-4" />
            {t("session_archive.save_duckdb")}
          </Button>
        </BackendConfigPanel>
      </section> : null}

      {section === "storage" ? <LifecycleStatusPanel status={props.lifecycleStatus} /> : null}
      </div>
    </div>
  );
}

function LifecycleStatusPanel(props: { status: OpenworkSessionArchiveLifecycleStatus | null }) {
  const status = props.status;
  return (
    <section className="rounded-lg border border-dls-border bg-dls-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Settings className="size-4 text-dls-secondary" />
          <h3 className="text-sm font-medium text-dls-text">{t("session_archive.lifecycle_title")}</h3>
        </div>
        <StatusBadge tone={status?.healthy ? "success" : "neutral"}>
          {status?.healthy ? t("session_archive.lifecycle_healthy") : t("session_archive.lifecycle_unknown")}
        </StatusBadge>
      </div>
      {status ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <UsageMetric label={t("session_archive.lifecycle_version")} value={status.version} />
            <UsageMetric label={t("session_archive.lifecycle_uptime")} value={formatSessionArchiveDuration(status.uptime_ms)} />
            <UsageMetric label={t("session_archive.lifecycle_sessions")} value={formatSessionArchiveNumber(status.stats.session_count)} />
            <UsageMetric label={t("session_archive.lifecycle_db_bytes")} value={formatSessionArchiveBytes(status.db_bytes)} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <PathSummary label={t("session_archive.lifecycle_runtime_root")} value={status.runtime_root} />
            <PathSummary label={t("session_archive.lifecycle_db_path")} value={status.db_path} />
          </div>
          <NoticeBox tone={status.update.supported ? "info" : "warning"} size="default">
            {status.update.supported
              ? t("session_archive.lifecycle_update_supported", { version: status.update.current_version })
              : (status.update.blocker ?? t("session_archive.lifecycle_update_blocked"))}
          </NoticeBox>
          <div>
            <div className="mb-2 text-xs font-medium uppercase text-dls-secondary">{t("session_archive.lifecycle_logs")}</div>
            <PathSummary label={t("session_archive.lifecycle_log_root")} value={status.logs.root} />
            {status.logs.files.length > 0 ? (
              <div className="mt-2 space-y-2">
                {status.logs.files.map((file) => (
                  <div key={file.path} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dls-border bg-dls-muted px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-dls-text">{file.name}</div>
                      <div className="truncate text-xs text-dls-secondary">{file.path}</div>
                    </div>
                    <div className="shrink-0 text-xs text-dls-secondary">{formatSessionArchiveBytes(file.bytes)} · {file.modified_at ?? t("common.unknown")}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm text-dls-secondary">{t("session_archive.lifecycle_no_logs")}</div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-sm text-dls-secondary">{t("session_archive.lifecycle_loading")}</div>
      )}
    </section>
  );
}

function BackendConfigPanel(props: {
  title: string;
  status: OpenworkSessionArchiveBackendsStatusResponse["backends"][number] | null;
  configuredPreview?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-dls-border bg-dls-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Settings className="size-4 text-dls-secondary" />
          <h3 className="text-sm font-medium text-dls-text">{props.title}</h3>
        </div>
        <StatusBadge tone={props.status?.configured ? "warning" : "neutral"}>
          {props.status?.configured ? t("session_archive.backend_configured") : t("session_archive.backend_not_configured")}
        </StatusBadge>
      </div>
      {props.configuredPreview ? <div className="mb-3 truncate text-xs text-dls-secondary">{props.configuredPreview}</div> : null}
      {props.status?.blocker ? <NoticeBox tone="warning" size="default">{props.status.blocker}</NoticeBox> : null}
      <div className="mt-3 space-y-3">{props.children}</div>
    </section>
  );
}

function MappingList(props: { mappings: OpenworkSessionArchiveWorktreeMapping[]; onDelete: (mappingId: string) => void }) {
  if (props.mappings.length === 0) {
    return <div className="mt-3 text-sm text-dls-secondary">{t("session_archive.no_mappings")}</div>;
  }
  return (
    <div className="mt-3 space-y-2">
      {props.mappings.map((mapping) => (
        <div key={mapping.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dls-border bg-dls-muted px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="truncate font-medium text-dls-text">{mapping.path_prefix}</div>
            <div className="truncate text-xs text-dls-secondary">{mapping.project}{mapping.machine ? ` / ${mapping.machine}` : ""}</div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={mapping.enabled ? "success" : "neutral"}>{mapping.enabled ? t("session_archive.mapping_enabled") : t("session_archive.mapping_disabled")}</StatusBadge>
            <Button type="button" variant="ghost" size="sm" onClick={() => props.onDelete(mapping.id)}>
              <Trash2 className="size-4" />
              {t("session_archive.delete_mapping")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SecretFindingList(props: { findings: OpenworkSessionArchiveSecretFinding[] }) {
  if (props.findings.length === 0) {
    return <div className="mt-3 text-sm text-dls-secondary">{t("session_archive.secrets_empty")}</div>;
  }
  return (
    <div className="mt-3 space-y-2">
      {props.findings.map((finding) => (
        <div key={finding.id} className="rounded-lg border border-dls-border bg-dls-muted px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 truncate text-sm font-medium text-dls-text">{finding.display_name || finding.session_id}</div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone={finding.confidence === "definite" ? "warning" : "neutral"}>{finding.confidence}</StatusBadge>
              <StatusBadge tone="neutral">{finding.rule}</StatusBadge>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-dls-secondary">
            <span>{finding.project}</span>
            <span>{finding.agent}</span>
            <span>{finding.location_kind}</span>
            <span>{t("session_archive.secrets_message", { ordinal: finding.message_ordinal })}</span>
          </div>
          <div className="mt-2 break-all rounded-lg border border-dls-border bg-dls-surface px-2 py-1 font-mono text-xs text-dls-text">
            {finding.redacted_match}
          </div>
        </div>
      ))}
    </div>
  );
}

export function UsagePanel(props: {
  loading: boolean;
  summary: OpenworkSessionArchiveUsageSummaryResponse | null;
  comparison: OpenworkSessionArchiveUsageComparison | null;
  topSessions: OpenworkSessionArchiveTopUsageSession[];
  selectedSession: OpenworkSessionArchiveSession;
  sessionUsage: OpenworkSessionArchiveSessionUsage | null;
}) {
  if (props.loading && !props.summary) {
    return <div className="text-sm text-dls-secondary">{t("session_archive.loading_usage")}</div>;
  }
  return (
    <div className="space-y-4">
      <MetricBand>
        <UsageMetric label={t("session_archive.usage_total_cost")} value={formatSessionArchiveCost(props.summary?.totals.totalCost ?? 0)} />
        <UsageMetric label={t("session_archive.usage_tokens")} value={formatSessionArchiveNumber((props.summary?.totals.inputTokens ?? 0) + (props.summary?.totals.outputTokens ?? 0))} />
        <UsageMetric label={t("session_archive.usage_cache_hit")} value={formatSessionArchivePercent(props.summary?.cacheStats.hitRate ?? 0)} />
        <UsageMetric label={t("session_archive.usage_delta")} value={formatSessionArchivePercent(props.comparison?.deltaPct ?? 0)} />
      </MetricBand>
      <ArchivePanelSection title={t("session_archive.session_usage")} action={<StatusBadge tone={props.sessionUsage?.has_token_data ? "success" : "neutral"}>{props.sessionUsage?.has_token_data ? t("session_archive.token_data") : t("session_archive.no_token_data")}</StatusBadge>}>
        <MetricBand>
          <UsageMetric label={t("session_archive.session_cost")} value={formatSessionArchiveCost(props.sessionUsage?.cost_usd ?? 0)} />
          <UsageMetric label={t("session_archive.session_output_tokens")} value={formatSessionArchiveNumber(props.sessionUsage?.total_output_tokens ?? props.selectedSession.total_output_tokens)} />
          <UsageMetric label={t("session_archive.session_peak_context")} value={formatSessionArchiveNumber(props.sessionUsage?.peak_context_tokens ?? props.selectedSession.peak_context_tokens)} />
          <UsageMetric label={t("session_archive.session_models")} value={(props.sessionUsage?.models ?? []).join(", ") || t("common.unknown")} />
        </MetricBand>
      </ArchivePanelSection>
      <section className="grid gap-4 lg:grid-cols-2">
        <UsageList title={t("session_archive.project_breakdown")} items={(props.summary?.projectTotals ?? []).map((item) => ({ label: item.project, value: `${formatSessionArchiveNumber(item.inputTokens + item.outputTokens)} / ${formatSessionArchiveCost(item.cost)}` }))} />
        <UsageList title={t("session_archive.model_breakdown")} items={(props.summary?.modelTotals ?? []).map((item) => ({ label: item.model, value: `${formatSessionArchiveNumber(item.inputTokens + item.outputTokens)} / ${formatSessionArchiveCost(item.cost)}` }))} />
      </section>
      <UsageList title={t("session_archive.top_usage_sessions")} items={props.topSessions.map((item) => ({ label: item.displayName || item.sessionId, value: `${formatSessionArchiveNumber(item.totalTokens)} / ${formatSessionArchiveCost(item.cost)}` }))} />
      <UsageList title={t("session_archive.daily_usage")} items={(props.summary?.daily ?? []).map((item) => ({ label: item.date, value: `${formatSessionArchiveNumber(item.inputTokens + item.outputTokens + item.cacheReadTokens + item.cacheCreationTokens)} / ${formatSessionArchiveCost(item.totalCost)}` }))} />
    </div>
  );
}

export function AnalyticsPanel(props: { loading: boolean; analytics: SessionArchiveAnalyticsState | null; generating: boolean; insightLog: string | null; onGenerate: () => void; onDeleteInsight: (insightId: number) => void }) {
  if (props.loading && !props.analytics) {
    return <div className="text-sm text-dls-secondary">{t("session_archive.loading_analytics")}</div>;
  }
  const analytics = props.analytics;
  return (
    <div className="space-y-4">
      <MetricBand>
        <UsageMetric label={t("session_archive.analytics_sessions")} value={formatSessionArchiveNumber(analytics?.summary.total_sessions ?? 0)} />
        <UsageMetric label={t("session_archive.analytics_messages")} value={formatSessionArchiveNumber(analytics?.summary.total_messages ?? 0)} />
        <UsageMetric label={t("session_archive.analytics_projects")} value={formatSessionArchiveNumber(analytics?.summary.active_projects ?? 0)} />
        <UsageMetric label={t("session_archive.analytics_p90_messages")} value={formatSessionArchiveNumber(analytics?.summary.p90_messages ?? 0)} />
      </MetricBand>
      <section className="grid gap-4 lg:grid-cols-2">
        <UsageList
          title={t("session_archive.analytics_activity")}
          items={(analytics?.activity.series ?? []).slice(-7).map((item) => ({
            label: item.date,
            value: `${formatSessionArchiveNumber(item.sessions)} / ${formatSessionArchiveNumber(item.messages)}`,
          }))}
        />
        <UsageList
          title={t("session_archive.analytics_heatmap")}
          items={(analytics?.heatmap.entries ?? []).slice(-7).map((item) => ({
            label: item.date,
            value: `${formatSessionArchiveNumber(item.value)} / ${t("session_archive.analytics_heatmap_level", { level: item.level })}`,
          }))}
        />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <UsageList
          title={t("session_archive.analytics_projects_list")}
          items={(analytics?.projects.projects ?? []).map((item) => ({
            label: item.name,
            value: `${formatSessionArchiveNumber(item.sessions)} / ${formatSessionArchiveNumber(item.messages)}`,
          }))}
        />
        <UsageList
          title={t("session_archive.analytics_session_shape")}
          items={(analytics?.sessions.length_distribution ?? []).map((item) => ({ label: item.label, value: formatSessionArchiveNumber(item.count) }))}
        />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <UsageList
          title={t("session_archive.analytics_tools")}
          items={(analytics?.tools.by_category ?? []).map((item) => ({
            label: item.category,
            value: `${formatSessionArchiveNumber(item.count)} / ${formatSessionArchivePercent(item.pct)}`,
          }))}
        />
        <UsageList
          title={t("session_archive.analytics_skills")}
          items={(analytics?.skills.by_skill ?? []).map((item) => ({
            label: item.skill_name,
            value: `${formatSessionArchiveNumber(item.call_count)} / ${formatSessionArchiveNumber(item.session_count)}`,
          }))}
        />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <UsageList
          title={t("session_archive.analytics_velocity")}
          items={[
            { label: t("session_archive.analytics_turn_cycle"), value: `${formatSessionArchiveNumber(analytics?.velocity.overall.turn_cycle_sec.p50 ?? 0)} / ${formatSessionArchiveNumber(analytics?.velocity.overall.turn_cycle_sec.p90 ?? 0)}` },
            { label: t("session_archive.analytics_first_response"), value: `${formatSessionArchiveNumber(analytics?.velocity.overall.first_response_sec.p50 ?? 0)} / ${formatSessionArchiveNumber(analytics?.velocity.overall.first_response_sec.p90 ?? 0)}` },
            { label: t("session_archive.analytics_msgs_per_min"), value: formatSessionArchiveNumber(analytics?.velocity.overall.msgs_per_active_min ?? 0) },
          ]}
        />
        <UsageList
          title={t("session_archive.analytics_signals")}
          items={[
            { label: t("session_archive.analytics_scored_sessions"), value: formatSessionArchiveNumber(analytics?.signals.scored_sessions ?? 0) },
            { label: t("session_archive.analytics_unscored_sessions"), value: formatSessionArchiveNumber(analytics?.signals.unscored_sessions ?? 0) },
            { label: t("session_archive.analytics_avg_health"), value: analytics?.signals.avg_health_score === null || analytics?.signals.avg_health_score === undefined ? t("common.unknown") : formatSessionArchivePercent(analytics.signals.avg_health_score) },
          ]}
        />
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <UsageList
          title={t("session_archive.activity_report")}
          items={[
            { label: t("session_archive.activity_agent_minutes"), value: formatSessionArchiveNumber(analytics?.activityReport?.totals.agent_minutes ?? 0) },
            { label: t("session_archive.activity_interactive_sessions"), value: formatSessionArchiveNumber(analytics?.activityReport?.totals.interactive_sessions ?? 0) },
            { label: t("session_archive.activity_automated_sessions"), value: formatSessionArchiveNumber(analytics?.activityReport?.totals.automated_sessions ?? 0) },
          ]}
        />
        <UsageList
          title={t("session_archive.trends_terms")}
          items={(analytics?.trends?.series ?? []).map((item) => ({
            label: item.term,
            value: formatSessionArchiveNumber(item.total),
          }))}
        />
      </section>
      <UsageList
        title={t("session_archive.analytics_top_sessions")}
        items={(analytics?.topSessions.sessions ?? []).map((item) => ({
          label: item.display_name || item.first_message || item.id,
          value: `${formatSessionArchiveNumber(item.message_count)} / ${formatSessionArchiveNumber(item.output_tokens)}`,
        }))}
      />
      <section className="rounded-lg border border-dls-border bg-dls-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-dls-text">{t("session_archive.insights")}</h3>
          <Button type="button" variant="outline" size="sm" onClick={props.onGenerate} disabled={props.generating}>
            <BarChart3 className="size-4" />
            {props.generating ? t("session_archive.insight_generating") : t("session_archive.insight_generate")}
          </Button>
        </div>
        {props.insightLog ? <div className="mb-3 text-xs text-dls-secondary">{props.insightLog}</div> : null}
        {(analytics?.insights?.insights ?? []).length > 0 ? (
          <div className="space-y-3">
            {(analytics?.insights?.insights ?? []).slice(0, 5).map((insight) => (
              <article key={insight.id} className="rounded-lg border border-dls-border bg-dls-muted px-3 py-2">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0 truncate text-sm font-medium text-dls-text">{insight.type}</div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => props.onDeleteInsight(insight.id)}>
                    {t("session_archive.insight_delete")}
                  </Button>
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-dls-secondary">{insight.content}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="text-sm text-dls-secondary">{t("session_archive.no_insights")}</div>
        )}
      </section>
    </div>
  );
}
