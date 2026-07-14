/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Filter,
  Folder,
  FolderOpen,
  MessageSquare,
} from "lucide-react";

import { IconTile, MenuRowButton, NavListButton } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t } from "../../../../../i18n";
import type { AssistantCategoryId } from "../../surface/personal-assistant-config";
import type { AgentConversationGroup } from "./conversation-model";
import type { AssistantAutomationGroup } from "./assistant-automation-groups";
import { AssistantTaskItem } from "./assistant-task-item";

type AssistantConversationTab = "all" | "tasks" | "spaces" | "automations";
const ASSISTANT_TASK_PREVIEW_LIMIT = 20;

type AssistantConversationSectionsProps = {
  categoryId: AssistantCategoryId;
  workspaceId: string;
  selectedSessionId: string | null;
  automationGroups: AssistantAutomationGroup<AgentConversationGroup>[];
  pinnedGroups: AgentConversationGroup[];
  taskGroups: AgentConversationGroup[];
  spaceGroups: [string, AgentConversationGroup[]][];
  expandedDirectories: string[];
  expandedAutomationDirectories: string[];
  onExpandedDirectoriesChange: (updater: (current: string[]) => string[]) => void;
  onExpandedAutomationDirectoriesChange: (updater: (current: string[]) => string[]) => void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onTogglePinned: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onDeleteSession?: (sessionId: string) => void;
};

function assistantDirectoryName(directory: string) {
  return (
    directory
      .replace(/\\/g, "/")
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean)
      .pop() ?? directory
  );
}

function assistantTaskSelected(
  group: AgentConversationGroup,
  selectedSessionId: string | null,
) {
  return group.sessions.some((session) => session.id === selectedSessionId);
}

function groupIncludesSession(
  groups: AgentConversationGroup[],
  selectedSessionId: string | null,
) {
  if (!selectedSessionId) return false;
  return groups.some((group) => assistantTaskSelected(group, selectedSessionId));
}

function groupedEntriesIncludeSession(
  groups: [string, AgentConversationGroup[]][],
  selectedSessionId: string | null,
) {
  if (!selectedSessionId) return false;
  return groups.some(([, items]) => groupIncludesSession(items, selectedSessionId));
}

function takeVisibleGroups(
  groups: AgentConversationGroup[],
  remaining: { value: number },
) {
  if (remaining.value <= 0) return [];
  const visible = groups.slice(0, remaining.value);
  remaining.value -= visible.length;
  return visible;
}

function takeVisibleGroupedEntries(
  groups: [string, AgentConversationGroup[]][],
  remaining: { value: number },
) {
  const visible: [string, AgentConversationGroup[]][] = [];
  for (const [directory, items] of groups) {
    if (remaining.value <= 0) break;
    const nextItems = takeVisibleGroups(items, remaining);
    if (nextItems.length > 0) visible.push([directory, nextItems]);
  }
  return visible;
}

function takeVisibleAutomationGroups(
  groups: AssistantAutomationGroup<AgentConversationGroup>[],
  remaining: { value: number },
) {
  const visible: AssistantAutomationGroup<AgentConversationGroup>[] = [];
  for (const group of groups) {
    if (remaining.value <= 0) break;
    const items = takeVisibleGroups(group.items, remaining);
    if (items.length > 0) visible.push({ ...group, items });
  }
  return visible;
}

function AssistantListEmptyState(props: {
  kind: AssistantConversationTab;
  title: string;
  description: string;
}) {
  const icon = (() => {
    if (props.kind === "spaces") return <FolderOpen className="size-5" />;
    if (props.kind === "automations") return <CalendarClock className="size-5" />;
    return <ClipboardList className="size-5" />;
  })();

  return (
    <div className="mx-1 mt-3 flex flex-col items-center gap-2.5 px-4 py-7 text-center">
      <IconTile size="lg" shape="xl" tone="neutral" className="bg-transparent text-dls-secondary">
        {icon}
      </IconTile>
      <div className="space-y-1">
        <div className="text-sm font-medium text-dls-text">{props.title}</div>
        <p className="mx-auto max-w-44 text-xs leading-5 text-dls-secondary">
          {props.description}
        </p>
      </div>
    </div>
  );
}

function AssistantTaskRows(props: {
  groups: AgentConversationGroup[];
  workspaceId: string;
  selectedSessionId: string | null;
  pinned?: boolean;
  pinnable?: boolean;
  typeIcon?: React.ReactNode;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onTogglePinned: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onDeleteSession?: (sessionId: string) => void;
}) {
  return (
    <>
      {props.groups.map((item) => (
        <AssistantTaskItem
          key={item.key}
          group={item}
          workspaceId={props.workspaceId}
          selected={assistantTaskSelected(item, props.selectedSessionId)}
          pinned={props.pinned}
          pinnable={props.pinnable}
          typeIcon={props.typeIcon}
          onOpenSession={props.onOpenSession}
          onPrefetchSession={props.onPrefetchSession}
          onTogglePinned={props.onTogglePinned}
          onRenameSession={props.onRenameSession}
          onDeleteSession={props.onDeleteSession}
        />
      ))}
    </>
  );
}

export function AssistantConversationSections(props: AssistantConversationSectionsProps) {
  const [activeFilter, setActiveFilter] = useState<AssistantConversationTab>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [showAllRows, setShowAllRows] = useState(false);

  const taskCount = props.pinnedGroups.length + props.taskGroups.length;
  const spacesCount = props.spaceGroups.reduce(
    (count, [, items]) => count + items.length,
    0,
  );
  const automationsCount = props.automationGroups.reduce(
    (count, group) => count + group.items.length,
    0,
  );
  const allCount = taskCount + spacesCount + automationsCount;

  const filterItems = useMemo(
    () => [
      {
        id: "all" as const,
        label: t("session.task_filter_all"),
        count: allCount,
        icon: <ClipboardList className="size-3.5" />,
      },
      {
        id: "tasks" as const,
        label: t("session.task_filter_tasks"),
        count: taskCount,
        icon: <MessageSquare className="size-3.5" />,
      },
      {
        id: "spaces" as const,
        label: t("session.task_filter_space_tasks"),
        count: spacesCount,
        icon: <Folder className="size-3.5" />,
      },
      {
        id: "automations" as const,
        label: t("session.task_filter_automation_tasks"),
        count: automationsCount,
        icon: <CalendarClock className="size-3.5" />,
      },
    ],
    [allCount, automationsCount, spacesCount, taskCount],
  );

  const activeFilterItem = filterItems.find((item) => item.id === activeFilter);

  useEffect(() => {
    if (
      groupIncludesSession(
        [...props.pinnedGroups, ...props.taskGroups],
        props.selectedSessionId,
      )
    ) {
      setActiveFilter((current) => current === "all" ? current : "tasks");
      return;
    }
    if (groupedEntriesIncludeSession(props.spaceGroups, props.selectedSessionId)) {
      setActiveFilter((current) => current === "all" ? current : "spaces");
      return;
    }
    if (
      groupIncludesSession(
        props.automationGroups.flatMap((group) => group.items),
        props.selectedSessionId,
      )
    ) {
      setActiveFilter((current) => current === "all" ? current : "automations");
    }
  }, [
    props.automationGroups,
    props.pinnedGroups,
    props.selectedSessionId,
    props.spaceGroups,
    props.taskGroups,
  ]);

  const showTasks = activeFilter === "all" || activeFilter === "tasks";
  const showSpaces = activeFilter === "all" || activeFilter === "spaces";
  const showAutomations = activeFilter === "all" || activeFilter === "automations";
  const visibleCount = (showTasks ? taskCount : 0) +
    (showSpaces ? spacesCount : 0) +
    (showAutomations ? automationsCount : 0);
  const rowsOverflow = visibleCount > ASSISTANT_TASK_PREVIEW_LIMIT;
  const remainingRows = { value: showAllRows ? Number.POSITIVE_INFINITY : ASSISTANT_TASK_PREVIEW_LIMIT };
  const visiblePinnedGroups = showTasks ? takeVisibleGroups(props.pinnedGroups, remainingRows) : [];
  const visibleTaskGroups = showTasks ? takeVisibleGroups(props.taskGroups, remainingRows) : [];
  const visibleSpaceGroups = showSpaces ? takeVisibleGroupedEntries(props.spaceGroups, remainingRows) : [];
  const visibleAutomationGroups = showAutomations
    ? takeVisibleAutomationGroups(props.automationGroups, remainingRows)
    : [];

  const hasContent =
    (showTasks && taskCount > 0) ||
    (showSpaces && spacesCount > 0) ||
    (showAutomations && automationsCount > 0);

  return (
    <div className="flex flex-col pt-1">
      <div
        data-assistant-task-list-header="true"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setExpanded((value) => !value);
        }}
        className="sticky top-0 z-10 flex h-8 w-full cursor-pointer items-center justify-between rounded-lg bg-dls-background px-2 text-dls-text transition-colors hover:bg-dls-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30"
        aria-expanded={expanded}
        title={expanded ? t("session.task_list_collapse") : t("session.task_list_expand")}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-dls-secondary">
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-dls-secondary" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-dls-secondary" />
          )}
          {t("session.task_list")}
        </span>
        <span className="flex min-w-0 items-center gap-1">
          {activeFilterItem && (
            <span className="min-w-0 truncate text-sm text-dls-secondary">
              <span>{activeFilterItem.label}</span>
              <span>({activeFilterItem.count})</span>
            </span>
          )}
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={(event) => event.stopPropagation()}
                  className="shrink-0 text-dls-secondary hover:bg-dls-active hover:text-dls-text data-[popup-open]:bg-dls-active data-[popup-open]:text-dls-text"
                  title={t("session.filter_tasks")}
                  aria-label={t("session.filter_tasks")}
                >
                  <Filter className="size-3.5" />
                </Button>
              }
            />
            <PopoverContent
              onClick={(event) => event.stopPropagation()}
              side="bottom"
              align="end"
              className="w-40 overflow-hidden rounded-xl border border-dls-border bg-dls-surface p-1"
            >
              <div className="flex flex-col gap-0.5">
                {filterItems.map((item) => (
                  <MenuRowButton
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveFilter(item.id);
                      setFilterOpen(false);
                    }}
                    className="justify-between text-xs"
                  >
                    <span className="flex items-center gap-2">
                      {item.icon}
                      <span className={activeFilter === item.id ? "text-dls-accent" : "text-dls-text"}>
                        {item.label}
                      </span>
                      {activeFilter === item.id ? (
                        <Check className="size-3.5 text-dls-accent" />
                      ) : null}
                    </span>
                    <span className="text-dls-secondary">
                      {item.count > 99 ? "99+" : item.count}
                    </span>
                  </MenuRowButton>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </span>
      </div>

      {expanded ? (
        <div className="space-y-1.5">
          {showTasks && visiblePinnedGroups.length > 0 ? (
            <div>
              <div className="flex h-8 w-full items-center gap-2 px-2 text-left text-sm font-medium text-dls-secondary">
                <span className="min-w-0 flex-1 truncate">
                  {t("session.pinned_count", {
                    count: props.pinnedGroups.length,
                  })}
                </span>
              </div>
              <div className="space-y-0.5">
                <AssistantTaskRows
                  groups={visiblePinnedGroups}
                  workspaceId={props.workspaceId}
                  selectedSessionId={props.selectedSessionId}
                  pinned
                  onOpenSession={props.onOpenSession}
                  onPrefetchSession={props.onPrefetchSession}
                  onTogglePinned={props.onTogglePinned}
                  onRenameSession={props.onRenameSession}
                  onDeleteSession={props.onDeleteSession}
                />
              </div>
            </div>
          ) : null}
          {showTasks && visibleTaskGroups.length > 0 ? (
            <div className="space-y-0.5">
              <AssistantTaskRows
                groups={visibleTaskGroups}
                workspaceId={props.workspaceId}
                selectedSessionId={props.selectedSessionId}
                onOpenSession={props.onOpenSession}
                onPrefetchSession={props.onPrefetchSession}
                onTogglePinned={props.onTogglePinned}
                onRenameSession={props.onRenameSession}
                onDeleteSession={props.onDeleteSession}
              />
            </div>
          ) : null}

          {showSpaces && visibleSpaceGroups.length > 0
            ? visibleSpaceGroups.map(([directory, items]) => {
                const expandedDir = props.expandedDirectories.includes(directory);
                const name = assistantDirectoryName(directory);
                return (
                  <div key={directory}>
                    <NavListButton
                      type="button"
                      size="compact"
                      onClick={() =>
                        props.onExpandedDirectoriesChange((current) =>
                          current.includes(directory)
                            ? current.filter((item) => item !== directory)
                            : [...current, directory],
                        )
                      }
                      className="text-sm hover:bg-dls-hover"
                      title={directory}
                      aria-expanded={expandedDir}
                    >
                      <Folder className="size-3.5 shrink-0 text-dls-secondary" />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      {expandedDir ? (
                        <ChevronDown className="size-3 shrink-0 text-dls-secondary" />
                      ) : (
                        <ChevronRight className="size-3 shrink-0 text-dls-secondary" />
                      )}
                    </NavListButton>
                    {expandedDir ? (
                      <div className="ml-5 space-y-0.5">
                        <AssistantTaskRows
                          groups={items}
                          workspaceId={props.workspaceId}
                          selectedSessionId={props.selectedSessionId}
                          onOpenSession={props.onOpenSession}
                          onPrefetchSession={props.onPrefetchSession}
                          onTogglePinned={props.onTogglePinned}
                          onRenameSession={props.onRenameSession}
                          onDeleteSession={props.onDeleteSession}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })
            : null}

          {showAutomations && visibleAutomationGroups.length > 0
            ? visibleAutomationGroups.map((group) => {
                const expandedAuto = props.expandedAutomationDirectories.includes(group.id);
                const groupLabel = t("automation.session_group_title", {
                  title: group.title,
                });
                return (
                  <div key={group.id}>
                    <NavListButton
                      type="button"
                      size="compact"
                      onClick={() =>
                        props.onExpandedAutomationDirectoriesChange((current) =>
                          current.includes(group.id)
                            ? current.filter((item) => item !== group.id)
                            : [...current, group.id],
                        )
                      }
                      className="text-sm hover:bg-dls-hover"
                      title={groupLabel}
                      aria-expanded={expandedAuto}
                    >
                      <span className="min-w-0 flex-1 truncate">{groupLabel}</span>
                      {expandedAuto ? (
                        <ChevronDown className="size-3 shrink-0 text-dls-secondary" />
                      ) : (
                        <ChevronRight className="size-3 shrink-0 text-dls-secondary" />
                      )}
                    </NavListButton>
                    {expandedAuto ? (
                      <div className="ml-5 space-y-0.5">
                        <AssistantTaskRows
                          groups={group.items}
                          workspaceId={props.workspaceId}
                          selectedSessionId={props.selectedSessionId}
                          typeIcon={<CalendarClock className="size-3.5 text-dls-secondary" />}
                          pinnable={false}
                          onOpenSession={props.onOpenSession}
                          onPrefetchSession={props.onPrefetchSession}
                          onTogglePinned={props.onTogglePinned}
                          onRenameSession={props.onRenameSession}
                          onDeleteSession={props.onDeleteSession}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })
            : null}

          {!hasContent ? (
            <AssistantListEmptyState
              kind={activeFilter}
              title={
                activeFilter === "tasks"
                  ? (props.categoryId === "code"
                    ? t("session.no_code_tasks")
                    : t("session.no_tasks"))
                  : activeFilter === "spaces"
                    ? t("session.no_space_tasks")
                    : activeFilter === "automations"
                      ? t("session.no_automation_tasks")
                      : t("session.no_content")
              }
              description={
                activeFilter === "tasks"
                  ? (props.categoryId === "code"
                    ? t("session.no_code_tasks_desc")
                    : t("session.no_tasks_desc"))
                  : activeFilter === "spaces"
                    ? t("session.no_space_tasks_desc")
                    : activeFilter === "automations"
                      ? t("session.no_automation_tasks_desc")
                      : t("session.no_content_desc")
              }
            />
          ) : null}
          {hasContent && rowsOverflow ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mx-1 mt-2 w-[calc(100%-0.5rem)] justify-center bg-dls-surface-muted text-xs text-dls-secondary font-normal hover:bg-dls-list-hover hover:text-dls-text"
              data-assistant-task-list-disclosure="true"
              onClick={() => setShowAllRows((value) => !value)}
            >
              {showAllRows ? (
                <ChevronUp className="size-3.5 shrink-0" />
              ) : (
                <ChevronDown className="size-3.5 shrink-0" />
              )}
              {showAllRows
                ? t("session.task_list_show_less")
                : t("session.task_list_show_more", {
                    count: visibleCount - ASSISTANT_TASK_PREVIEW_LIMIT,
                  })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
