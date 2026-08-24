/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
} from "react";
import { Archive, Trash2, X } from "lucide-react";

import { NavListButton } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { t } from "../../../../i18n";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import {
  buildAssistantBatchSections,
  groupIncludesSession,
  isAssistantBatchOperationCurrent,
  pinOwnsSession,
  reconcileAssistantBatchSelection,
  resolveAssistantBatchSelection,
  toggleAssistantBatchSelection,
  type AssistantBatchOperationFailure,
  type AssistantBatchSectionId,
  type AssistantBatchSelectionState,
  type AssistantBatchTask,
  type AssistantListModel,
} from "./assistant-list-model";
import {
  resolveUnreadAgentIdForSession,
  useExpertUnreadStore,
} from "../status/expert-unread-store";

export type AssistantMenuItem = {
  id: "automation";
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
};

export function AssistantMenuRow(props: {
  item: AssistantMenuItem;
  active?: boolean;
  onClick?: () => void;
}) {
  const Icon = props.item.icon;
  return (
    <NavListButton
      type="button"
      onClick={props.onClick}
      active={props.active}
      size="sidebar"
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
      {props.item.label}
    </NavListButton>
  );
}

export type AssistantBatchDeleteResult = {
  succeededIds: string[];
  failures: AssistantBatchOperationFailure[];
};

export function AssistantBatchCheckbox({
  className,
  ...props
}: ComponentProps<typeof Checkbox>) {
  return <Checkbox {...props} className={cn("rounded-xs", className)} />;
}

export function useAssistantBatchActions(input: {
  scopeKey: string;
  listModel: AssistantListModel;
  onArchiveTasks: (tasks: readonly AssistantBatchTask[]) => Promise<void> | void;
  onDeleteSessions?: (
    sessionIds: readonly string[],
  ) => Promise<AssistantBatchDeleteResult>;
  onDeleteFailures?: (failures: readonly AssistantBatchOperationFailure[]) => void;
}) {
  const sections = useMemo(
    () => buildAssistantBatchSections(input.listModel),
    [input.listModel],
  );
  const allTasks = useMemo(
    () => [...sections.pinned, ...sections.recent, ...sections.spaces],
    [sections],
  );
  const allSessionIds = useMemo(
    () => allTasks.map((task) => task.sessionId),
    [allTasks],
  );
  const sectionSessionIds = useMemo(
    () => ({
      pinned: sections.pinned.map((task) => task.sessionId),
      recent: sections.recent.map((task) => task.sessionId),
      spaces: sections.spaces.map((task) => task.sessionId),
    }),
    [sections],
  );
  const [active, setActive] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const scopeGenerationRef = useRef(0);

  const resetSelection = useCallback(() => {
    setActive(false);
    setSelectedSessionIds(new Set());
    setDeleteOpen(false);
  }, []);

  useEffect(() => {
    scopeGenerationRef.current += 1;
    resetSelection();
    setBusy(busyRef.current);
  }, [input.scopeKey, resetSelection]);

  useEffect(() => {
    setSelectedSessionIds((current) => {
      const next = reconcileAssistantBatchSelection(current, allSessionIds);
      if (
        next.size === current.size &&
        [...next].every((sessionId) => current.has(sessionId))
      ) {
        return current;
      }
      return next;
    });
  }, [allSessionIds]);

  const selectionState = useMemo(
    () => resolveAssistantBatchSelection(allSessionIds, selectedSessionIds),
    [allSessionIds, selectedSessionIds],
  );
  const sectionSelectionState = useMemo(
    () => ({
      pinned: resolveAssistantBatchSelection(
        sectionSessionIds.pinned,
        selectedSessionIds,
      ),
      recent: resolveAssistantBatchSelection(
        sectionSessionIds.recent,
        selectedSessionIds,
      ),
      spaces: resolveAssistantBatchSelection(
        sectionSessionIds.spaces,
        selectedSessionIds,
      ),
    }),
    [sectionSessionIds, selectedSessionIds],
  );

  const enter = useCallback(() => {
    setActive(true);
    setSelectedSessionIds(new Set());
    setDeleteOpen(false);
  }, []);
  const cancel = useCallback(() => {
    if (!busyRef.current) resetSelection();
  }, [resetSelection]);
  const toggleSession = useCallback((sessionId: string) => {
    setSelectedSessionIds((current) =>
      toggleAssistantBatchSelection(current, [sessionId]),
    );
  }, []);
  const toggleSection = useCallback(
    (sectionId: AssistantBatchSectionId) => {
      setSelectedSessionIds((current) =>
        toggleAssistantBatchSelection(current, sectionSessionIds[sectionId]),
      );
    },
    [sectionSessionIds],
  );
  const toggleAll = useCallback(() => {
    setSelectedSessionIds((current) =>
      toggleAssistantBatchSelection(current, allSessionIds),
    );
  }, [allSessionIds]);
  const selectedTasks = useMemo(
    () => allTasks.filter((task) => selectedSessionIds.has(task.sessionId)),
    [allTasks, selectedSessionIds],
  );

  const archiveSelected = useCallback(async () => {
    if (selectedTasks.length === 0 || busyRef.current) return;
    const operationGeneration = scopeGenerationRef.current;
    busyRef.current = true;
    setBusy(true);
    try {
      await input.onArchiveTasks(selectedTasks);
      if (
        isAssistantBatchOperationCurrent(
          operationGeneration,
          scopeGenerationRef.current,
        )
      ) {
        resetSelection();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [input.onArchiveTasks, resetSelection, selectedTasks]);

  const requestDelete = useCallback(() => {
    if (!input.onDeleteSessions || selectedTasks.length === 0 || busyRef.current) return;
    setDeleteOpen(true);
  }, [input.onDeleteSessions, selectedTasks.length]);
  const cancelDelete = useCallback(() => {
    if (!busyRef.current) setDeleteOpen(false);
  }, []);
  const confirmDelete = useCallback(async () => {
    if (!input.onDeleteSessions || selectedTasks.length === 0 || busyRef.current) return;
    const operationGeneration = scopeGenerationRef.current;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await input.onDeleteSessions(
        selectedTasks.map((task) => task.sessionId),
      );
      if (
        !isAssistantBatchOperationCurrent(
          operationGeneration,
          scopeGenerationRef.current,
        )
      ) {
        return;
      }
      if (result.failures.length === 0) {
        resetSelection();
        return;
      }
      setSelectedSessionIds(
        new Set(result.failures.map((failure) => failure.sessionId)),
      );
      setDeleteOpen(false);
      input.onDeleteFailures?.(result.failures);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [input.onDeleteFailures, input.onDeleteSessions, resetSelection, selectedTasks]);

  return {
    active,
    busy,
    canDelete: Boolean(input.onDeleteSessions),
    deleteOpen,
    selectedSessionIds,
    selectedTasks,
    selectionState,
    sectionSelectionState: sectionSelectionState satisfies Record<
      AssistantBatchSectionId,
      AssistantBatchSelectionState
    >,
    enter,
    cancel,
    toggleSession,
    toggleSection,
    toggleAll,
    archiveSelected,
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
}

export function AssistantBatchActionBar(props: {
  selectionState: AssistantBatchSelectionState;
  busy: boolean;
  canDelete: boolean;
  onToggleAll: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onArchive: () => void;
}) {
  const selectAllId = useId();
  const hasSelection = props.selectionState.selectedCount > 0;
  const selectAllLabel = hasSelection
    ? t("session.batch_select_all_count", {
        count: props.selectionState.selectedCount,
      })
    : t("session.batch_select_all");

  return (
    <div
      className="-mx-2.5 shrink-0 border-t border-dls-border px-2.5 pt-2"
      data-assistant-batch-actions="true"
      data-assistant-batch-selected-count={props.selectionState.selectedCount}
    >
      <div className="flex h-8 items-center gap-2 px-1">
        <AssistantBatchCheckbox
          id={selectAllId}
          checked={props.selectionState.checked}
          indeterminate={props.selectionState.indeterminate}
          disabled={props.busy || props.selectionState.totalCount === 0}
          onCheckedChange={props.onToggleAll}
          aria-label={selectAllLabel}
        />
        <label
          htmlFor={selectAllId}
          className="min-w-0 flex-1 cursor-pointer truncate text-sm text-dls-text"
        >
          {selectAllLabel}
        </label>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={props.busy}
          aria-label={t("session.batch_cancel")}
          data-assistant-batch-cancel="true"
          onClick={props.onCancel}
        >
          <X />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={!hasSelection || props.busy || !props.canDelete}
          data-assistant-batch-delete="true"
          onClick={props.onDelete}
        >
          <Trash2 />
          {t("session.delete_task")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasSelection || props.busy}
          data-assistant-batch-archive="true"
          onClick={props.onArchive}
        >
          <Archive />
          {t("session.archive_task")}
        </Button>
      </div>
    </div>
  );
}

export function AssistantBatchDeleteModal(props: {
  open: boolean;
  count: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmModal
      open={props.open}
      title={t("session.batch_delete_title")}
      message={t("session.batch_delete_message", { count: props.count })}
      confirmLabel={t("session.batch_delete_confirm", { count: props.count })}
      cancelLabel={t("common.cancel")}
      variant="danger"
      onConfirm={props.onConfirm}
      onCancel={props.busy ? () => undefined : props.onCancel}
    />
  );
}

export function useAssistantConversationSectionsState(input: {
  workspaceId: string;
  selectedSessionId: string | null;
  listModel: AssistantListModel;
}) {
  const [expandedSections, setExpandedSections] = useState<
    Record<AssistantBatchSectionId, boolean>
  >({ pinned: true, recent: true, spaces: true });
  const [showAllBySection, setShowAllBySection] = useState<
    Record<AssistantBatchSectionId, boolean>
  >({ pinned: false, recent: false, spaces: false });
  const [showAllByFolder, setShowAllByFolder] = useState<
    Record<string, boolean>
  >({});
  const setFocusedAgent = useExpertUnreadStore((state) => state.setFocusedAgent);

  useEffect(() => {
    const sessionId = input.selectedSessionId?.trim() || null;
    const scopeId = sessionId
      ? resolveUnreadAgentIdForSession(input.workspaceId, sessionId)
      : null;
    setFocusedAgent(input.workspaceId, scopeId);
  }, [input.selectedSessionId, input.workspaceId, setFocusedAgent]);

  const selectedOwnerSection = useMemo((): AssistantBatchSectionId | null => {
    const selected = input.selectedSessionId;
    if (!selected) return null;
    const model = input.listModel;
    if (
      model.globalPins.some((pin) =>
        pinOwnsSession(
          pin,
          selected,
          model.groupsBySessionId,
          model.spaceItemsByDirectory,
          new Map(),
        ),
      )
    ) {
      return "pinned";
    }
    if (groupIncludesSession(model.recentGroups, selected)) return "recent";
    if (
      model.spaceFolders.some((folder) =>
        groupIncludesSession(folder.items, selected),
      )
    ) {
      return "spaces";
    }
    return null;
  }, [input.listModel, input.selectedSessionId]);

  useEffect(() => {
    if (!selectedOwnerSection) return;
    setExpandedSections((current) =>
      current[selectedOwnerSection]
        ? current
        : { ...current, [selectedOwnerSection]: true },
    );
  }, [selectedOwnerSection]);

  return {
    expandedSections,
    showAllBySection,
    showAllByFolder,
    toggleSection: (id: AssistantBatchSectionId) =>
      setExpandedSections((current) => ({ ...current, [id]: !current[id] })),
    expandSection: (id: AssistantBatchSectionId) =>
      setExpandedSections((current) =>
        current[id] ? current : { ...current, [id]: true },
      ),
    toggleShowAll: (id: AssistantBatchSectionId) =>
      setShowAllBySection((current) => ({ ...current, [id]: !current[id] })),
    toggleShowAllFolder: (folderKey: string) =>
      setShowAllByFolder((current) => ({
        ...current,
        [folderKey]: !current[folderKey],
      })),
  };
}
