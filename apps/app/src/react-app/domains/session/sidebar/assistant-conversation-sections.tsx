/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import type { AgentConversationGroup, AssistantGlobalPin } from "./conversation-model";
import type { AssistantAutomationGroup } from "./assistant-automation-groups";
import type { AssistantListModel } from "./assistant-list-model";
import {
  assistantDirectoryName,
  dropSlotToIndex,
  groupIncludesSession,
  pinOwnsSession,
} from "./assistant-list-model";
import { TASK_ROW_ACTION_CLASS } from "./assistant-task-item";
import {
  resolveUnreadAgentIdForSession,
  useExpertUnreadStore,
} from "../status/expert-unread-store";
import {
  AssistantListEmptyState,
  AssistantTaskRows,
  FolderChildren,
  IconHoverTip,
  LIST_STACK_GAP,
  PinDropIndicator,
  RECENT_PREVIEW_LIMIT,
  SectionHeader,
  SectionShowMore,
  SpaceDirectoryRow,
  SpaceFolderDragList,
  dropSlotFromEvent,
} from "./assistant-conversation-rows";

type SectionId = "pinned" | "recent" | "spaces" | "automations";

type AssistantConversationSectionsProps = {
  categoryId: AssistantCategoryId;
  workspaceId: string;
  selectedSessionId: string | null;
  sessionStatusById?: Record<string, string>;
  /** Unpinned scheduled groups for the Schedules section. */
  automationGroups: AssistantAutomationGroup<AgentConversationGroup>[];
  /**
   * All scheduled groups (incl. globally pinned) — used by the pin strip and
   * local-pin lookup. Defaults to automationGroups when omitted.
   */
  automationGroupsAll?: AssistantAutomationGroup<AgentConversationGroup>[];
  /** automationId → local pin order inside that scheduled group. */
  automationLocalPinsById?: Record<string, string[]>;
  /** Built once in the panel — pin / space / recent rules. */
  listModel: AssistantListModel;
  expandedDirectories: string[];
  expandedAutomationDirectories: string[];
  onExpandedDirectoriesChange: (updater: (current: string[]) => string[]) => void;
  onExpandedAutomationDirectoriesChange: (updater: (current: string[]) => string[]) => void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onTogglePinned: (sessionId: string) => void;
  onToggleFolderPinned?: (directory: string) => void;
  onToggleAutomationGroupPinned?: (groupId: string) => void;
  onReorderGlobalPins?: (fromIndex: number, toIndex: number) => void;
  onReorderSpaceFolders?: (orderedDirectories: string[]) => void;
  onRenameSession?: (sessionId: string, currentTitle: string) => void;
  onArchiveSession?: (sessionId: string, title: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onOpenFolder?: (path: string) => void;
  onSaveToSpace?: (sessionId: string) => void;
  onRemoveSpaceDirectory?: (directory: string) => void;
  onArchiveSpaceDirectory?: (directory: string) => void;
  onCreateTaskInDirectory?: (directory: string) => void;
  /** Soft-archive every run under a scheduled-task group. */
  onArchiveAutomationGroup?: (groupId: string) => void;
  /** Confirm + permanently delete every run under a scheduled-task group. */
  onDeleteAutomationGroup?: (target: {
    groupId: string;
    title: string;
    sessionIds: string[];
  }) => void;
};

export function AssistantConversationSections(props: AssistantConversationSectionsProps) {
  // Recent open by default; spaces open; automations collapsed.
  // Selection still forces its owning section open.
  const [expandedSections, setExpandedSections] = useState<Record<SectionId, boolean>>({
    pinned: true,
    recent: true,
    spaces: true,
    automations: false,
  });
  const [showAllBySection, setShowAllBySection] = useState<Record<SectionId, boolean>>({
    pinned: false,
    recent: false,
    spaces: false,
    automations: false,
  });
  /** Per space-folder / automation-group: expand beyond FOLDER_TASK_PREVIEW_LIMIT. */
  const [showAllByFolder, setShowAllByFolder] = useState<Record<string, boolean>>({});

  const setFocusedAgent = useExpertUnreadStore((state) => state.setFocusedAgent);

  // Keep unread cursor in sync with the open assistant task (clears blue dot).
  useEffect(() => {
    const sessionId = props.selectedSessionId?.trim() || null;
    const scopeId = sessionId ? resolveUnreadAgentIdForSession(props.workspaceId, sessionId) : null;
    setFocusedAgent(props.workspaceId, scopeId);
  }, [props.selectedSessionId, props.workspaceId, setFocusedAgent]);

  const {
    globalPins,
    groupsBySessionId,
    spaceItemsByDirectory,
    spaceFolders,
    recentGroups,
    folderPathBySessionId,
    spaceLocalPinsByDirectory,
    allSpaceDirectories,
  } = props.listModel;

  // Home no longer lists automation groups; empty map keeps pin ownership helpers typed.
  const automationItemsById = useMemo(() => new Map<string, AgentConversationGroup[]>(), []);

  const pinnedCount = globalPins.length;
  const recentCount = recentGroups.length;
  const spacesCount = spaceFolders.reduce((count, folder) => count + folder.items.length, 0);
  const spaceDirectoryCount = spaceFolders.length;
  const allSpaceDirectoriesExpanded =
    spaceDirectoryCount > 0 &&
    spaceFolders.every((folder) => props.expandedDirectories.includes(folder.directory));
  // allSpaceDirectories comes from listModel (spaceFolderOrder storage order),
  // not Map.keys() discovery order — required for correct pin-slot merge.
  // Which top-level section owns the selected session (stable string key).
  // Computed in render so the expand effect only depends on this primitive —
  // unstable Map/array deps previously re-fired setExpandedSections every paint.
  const selectedOwnerSection = useMemo((): SectionId | null => {
    const selected = props.selectedSessionId;
    if (!selected) return null;
    if (
      globalPins.some((pin) =>
        pinOwnsSession(
          pin,
          selected,
          groupsBySessionId,
          spaceItemsByDirectory,
          automationItemsById,
        ),
      )
    ) {
      return "pinned";
    }
    if (groupIncludesSession(recentGroups, selected)) return "recent";
    if (spaceFolders.some((folder) => groupIncludesSession(folder.items, selected))) {
      return "spaces";
    }
    return null;
  }, [
    automationItemsById,
    globalPins,
    groupsBySessionId,
    props.selectedSessionId,
    recentGroups,
    spaceFolders,
    spaceItemsByDirectory,
  ]);

  // Keep the section that owns the selected session expanded.
  useEffect(() => {
    if (!selectedOwnerSection) return;
    setExpandedSections((current) =>
      current[selectedOwnerSection] ? current : { ...current, [selectedOwnerSection]: true },
    );
  }, [selectedOwnerSection]);

  const toggleSection = (id: SectionId) => {
    setExpandedSections((current) => ({ ...current, [id]: !current[id] }));
  };

  const toggleShowAll = (id: SectionId) => {
    setShowAllBySection((current) => ({ ...current, [id]: !current[id] }));
  };

  const toggleShowAllFolder = (folderKey: string) => {
    setShowAllByFolder((current) => ({
      ...current,
      [folderKey]: !current[folderKey],
    }));
  };

  const showAllRecent = showAllBySection.recent;
  const visibleRecentGroups =
    showAllRecent || recentGroups.length <= RECENT_PREVIEW_LIMIT
      ? recentGroups
      : recentGroups.slice(0, RECENT_PREVIEW_LIMIT);
  const recentOverflow = recentGroups.length > RECENT_PREVIEW_LIMIT;

  // Codex-style pin reorder: drag the row itself (no grip dots) + blue insert line.
  // Header/session surface is draggable; nested tasks under folders stay outside.
  const dragPinFromRef = useRef<number | null>(null);
  const [pinDragFrom, setPinDragFrom] = useState<number | null>(null);
  const [pinDropSlot, setPinDropSlot] = useState<number | null>(null);

  const clearPinDrag = () => {
    dragPinFromRef.current = null;
    setPinDragFrom(null);
    setPinDropSlot(null);
  };

  const handlePinDragStart = (pinIndex: number, event: DragEvent) => {
    if (!props.onReorderGlobalPins) return;
    const target = event.target;
    // Block action chips / menus / nested task lists. Title/open surface may
    // start drag (expand control is a <button> and must still be allowed).
    if (target instanceof Element && target.closest("[data-no-drag], a, input, textarea")) {
      event.preventDefault();
      return;
    }
    dragPinFromRef.current = pinIndex;
    setPinDragFrom(pinIndex);
    try {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(pinIndex));
    } catch {
      // ignore
    }
  };

  const handlePinDragOver = (pinIndex: number, event: DragEvent) => {
    if (dragPinFromRef.current === null || !props.onReorderGlobalPins) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const slot = dropSlotFromEvent(event, pinIndex, globalPins.length);
    setPinDropSlot((current) => (current === slot ? current : slot));
  };

  const handlePinDrop = (pinIndex: number, event: DragEvent) => {
    event.preventDefault();
    const from = dragPinFromRef.current;
    const slot = pinDropSlot ?? dropSlotFromEvent(event, pinIndex, globalPins.length);
    clearPinDrag();
    if (from === null || !props.onReorderGlobalPins) return;
    const to = dropSlotToIndex(from, slot);
    if (to === from) return;
    props.onReorderGlobalPins(from, to);
  };

  const canReorderPins = Boolean(props.onReorderGlobalPins);

  /** Drop target + drag source props for a pin header/session surface. */
  const pinDragSurfaceProps = (pinIndex: number) =>
    canReorderPins
      ? {
          draggable: true as const,
          className: "cursor-grab active:cursor-grabbing",
          onDragStart: (event: DragEvent) => handlePinDragStart(pinIndex, event),
          onDragEnd: () => clearPinDrag(),
          onDragOver: (event: DragEvent) => handlePinDragOver(pinIndex, event),
          onDrop: (event: DragEvent) => handlePinDrop(pinIndex, event),
        }
      : {
          onDragOver: (event: DragEvent) => handlePinDragOver(pinIndex, event),
          onDrop: (event: DragEvent) => handlePinDrop(pinIndex, event),
        };

  const renderPinRow = (pin: AssistantGlobalPin, pinIndex: number) => {
    const isDragging = pinDragFrom === pinIndex;
    const surface = pinDragSurfaceProps(pinIndex);

    if (pin.kind === "session") {
      const group = groupsBySessionId.get(pin.id);
      if (!group) return null;
      return (
        <div
          key={`pin-session:${pin.id}`}
          className={cn("min-w-0", surface.className, isDragging && "opacity-40")}
          draggable={surface.draggable}
          onDragStart={surface.onDragStart}
          onDragEnd={surface.onDragEnd}
          onDragOver={surface.onDragOver}
          onDrop={surface.onDrop}
        >
          <AssistantTaskRows
            groups={[group]}
            workspaceId={props.workspaceId}
            selectedSessionId={props.selectedSessionId}
            sessionStatusById={props.sessionStatusById}
            pinned
            singleLine
            folderPathBySessionId={folderPathBySessionId}
            onOpenSession={props.onOpenSession}
            onPrefetchSession={props.onPrefetchSession}
            onTogglePinned={props.onTogglePinned}
            onRenameSession={props.onRenameSession}
            onArchiveSession={props.onArchiveSession}
            onDeleteSession={props.onDeleteSession}
            onOpenFolder={props.onOpenFolder}
            onSaveToSpace={props.onSaveToSpace}
          />
        </div>
      );
    }

    // Automation pins moved to the primary-rail Automation workspace.
    if (pin.kind === "automation") return null;

    const items = spaceItemsByDirectory.get(pin.id) ?? [];
    const name = assistantDirectoryName(pin.id);
    return (
      <div
        key={`pin-folder:${pin.id}`}
        className={cn("flex flex-col", LIST_STACK_GAP, isDragging && "opacity-40")}
        onDragOver={surface.onDragOver}
        onDrop={surface.onDrop}
      >
        <div
          className={cn("min-w-0", surface.className)}
          draggable={surface.draggable}
          onDragStart={surface.onDragStart}
          onDragEnd={surface.onDragEnd}
        >
          <SpaceDirectoryRow
            name={name}
            directory={pin.id}
            expanded={props.expandedDirectories.includes(pin.id)}
            pinned
            sessionCount={items.length}
            onToggle={() =>
              props.onExpandedDirectoriesChange((current) =>
                current.includes(pin.id)
                  ? current.filter((item) => item !== pin.id)
                  : [...current, pin.id],
              )
            }
            onTogglePinned={props.onToggleFolderPinned}
            onOpenFolder={props.onOpenFolder}
            onArchiveDirectory={props.onArchiveSpaceDirectory}
            onRemoveFromList={props.onRemoveSpaceDirectory}
            onCreateTask={props.onCreateTaskInDirectory}
          />
        </div>
        {props.expandedDirectories.includes(pin.id) ? (
          <FolderChildren>
            <div data-no-drag>
              <AssistantTaskRows
                groups={items}
                workspaceId={props.workspaceId}
                selectedSessionId={props.selectedSessionId}
                sessionStatusById={props.sessionStatusById}
                singleLine
                pinnedSessionIds={new Set(spaceLocalPinsByDirectory[pin.id] ?? [])}
                folderPath={pin.id}
                folderPathBySessionId={folderPathBySessionId}
                onOpenSession={props.onOpenSession}
                onPrefetchSession={props.onPrefetchSession}
                onTogglePinned={props.onTogglePinned}
                onRenameSession={props.onRenameSession}
                onArchiveSession={props.onArchiveSession}
                onDeleteSession={props.onDeleteSession}
                onOpenFolder={props.onOpenFolder}
                onSaveToSpace={props.onSaveToSpace}
              />
            </div>
          </FolderChildren>
        ) : null}
      </div>
    );
  };

  const emptyTasksLabel = t("session.no_tasks");

  return (
    <TooltipProvider delay={200}>
      <div
        className={cn("mt-1 flex flex-col pt-1", LIST_STACK_GAP)}
        data-assistant-task-list="true"
      >
        {/* Global pins — sessions + folders; Codex-style drag insert line */}
        {pinnedCount > 0 ? (
          <div data-assistant-section="pinned" className={cn("flex flex-col", LIST_STACK_GAP)}>
            <SectionHeader
              label={t("session.pinned_section")}
              expanded={expandedSections.pinned}
              onToggle={() => toggleSection("pinned")}
              quiet
            />
            {expandedSections.pinned ? (
              <div
                className={cn("flex flex-col pb-1", LIST_STACK_GAP)}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node)) {
                    return;
                  }
                  setPinDropSlot(null);
                }}
              >
                {globalPins.map((pin, pinIndex) => (
                  <div key={`${pin.kind}:${pin.id}`}>
                    {pinDragFrom !== null && pinDropSlot === pinIndex ? <PinDropIndicator /> : null}
                    {renderPinRow(pin, pinIndex)}
                  </div>
                ))}
                {pinDragFrom !== null && pinDropSlot === globalPins.length ? (
                  <PinDropIndicator />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Recent — unpinned non-space sessions (single list; no separate tasks) */}
        <div data-assistant-section="recent" className={cn("flex flex-col", LIST_STACK_GAP)}>
          <SectionHeader
            label={t("session.recent_section")}
            expanded={expandedSections.recent}
            onToggle={() => toggleSection("recent")}
            quiet
          />
          {expandedSections.recent ? (
            <div className={cn("flex flex-col pb-1", LIST_STACK_GAP)}>
              {recentCount === 0 ? (
                <AssistantListEmptyState label={emptyTasksLabel} />
              ) : (
                <>
                  <AssistantTaskRows
                    groups={visibleRecentGroups}
                    workspaceId={props.workspaceId}
                    selectedSessionId={props.selectedSessionId}
                    sessionStatusById={props.sessionStatusById}
                    singleLine
                    folderPathBySessionId={folderPathBySessionId}
                    onOpenSession={props.onOpenSession}
                    onPrefetchSession={props.onPrefetchSession}
                    onTogglePinned={props.onTogglePinned}
                    onRenameSession={props.onRenameSession}
                    onArchiveSession={props.onArchiveSession}
                    onDeleteSession={props.onDeleteSession}
                    onOpenFolder={props.onOpenFolder}
                    onSaveToSpace={props.onSaveToSpace}
                  />
                  <SectionShowMore
                    overflow={recentOverflow}
                    showAll={showAllRecent}
                    hiddenCount={recentCount - RECENT_PREVIEW_LIMIT}
                    onToggle={() => toggleShowAll("recent")}
                  />
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Spaces — folders not in global pins */}
        <div data-assistant-section="spaces" className={cn("flex flex-col", LIST_STACK_GAP)}>
          <SectionHeader
            label={t("session.task_filter_space_tasks")}
            expanded={expandedSections.spaces}
            onToggle={() => toggleSection("spaces")}
            quiet
            trailing={
              spacesCount > 0 || spaceDirectoryCount > 0 ? (
                <IconHoverTip
                  label={
                    allSpaceDirectoriesExpanded
                      ? t("session.collapse_all_spaces")
                      : t("session.expand_all_spaces")
                  }
                >
                  <button
                    type="button"
                    className={cn(
                      TASK_ROW_ACTION_CLASS,
                      "opacity-0 transition-opacity group-hover/section:opacity-100",
                      expandedSections.spaces && "opacity-100",
                    )}
                    aria-label={
                      allSpaceDirectoriesExpanded
                        ? t("session.collapse_all_spaces")
                        : t("session.expand_all_spaces")
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!expandedSections.spaces) {
                        setExpandedSections((current) => ({
                          ...current,
                          spaces: true,
                        }));
                      }
                      if (allSpaceDirectoriesExpanded) {
                        props.onExpandedDirectoriesChange(() => []);
                        return;
                      }
                      props.onExpandedDirectoriesChange(() =>
                        spaceFolders.map((folder) => folder.directory),
                      );
                    }}
                  >
                    {allSpaceDirectoriesExpanded ? (
                      <Minimize2 strokeWidth={1.75} />
                    ) : (
                      <Maximize2 strokeWidth={1.75} />
                    )}
                  </button>
                </IconHoverTip>
              ) : null
            }
          />
          {expandedSections.spaces ? (
            <div className={cn("flex flex-col pb-1", LIST_STACK_GAP)}>
              {spaceDirectoryCount === 0 ? (
                <AssistantListEmptyState label={t("session.no_space_tasks")} />
              ) : (
                <SpaceFolderDragList
                  folders={spaceFolders}
                  workspaceId={props.workspaceId}
                  selectedSessionId={props.selectedSessionId}
                  sessionStatusById={props.sessionStatusById}
                  expandedDirectories={props.expandedDirectories}
                  folderPathBySessionId={folderPathBySessionId}
                  showAllByFolder={showAllByFolder}
                  allSpaceDirectories={allSpaceDirectories}
                  onExpandedDirectoriesChange={props.onExpandedDirectoriesChange}
                  onToggleFolderPinned={props.onToggleFolderPinned}
                  onReorderSpaceFolders={props.onReorderSpaceFolders}
                  onOpenFolder={props.onOpenFolder}
                  onArchiveDirectory={props.onArchiveSpaceDirectory}
                  onRemoveFromList={props.onRemoveSpaceDirectory}
                  onCreateTask={props.onCreateTaskInDirectory}
                  onOpenSession={props.onOpenSession}
                  onPrefetchSession={props.onPrefetchSession}
                  onTogglePinned={props.onTogglePinned}
                  onRenameSession={props.onRenameSession}
                  onArchiveSession={props.onArchiveSession}
                  onDeleteSession={props.onDeleteSession}
                  onSaveToSpace={props.onSaveToSpace}
                  onToggleShowAllFolder={toggleShowAllFolder}
                />
              )}
            </div>
          ) : null}
        </div>

        {/* Schedules / automation groups live on the primary-rail Automation page. */}
      </div>
    </TooltipProvider>
  );
}
