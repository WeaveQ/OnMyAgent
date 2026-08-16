import { useEffect, useMemo, useRef, useState } from "react";

import { installExpertPackage } from "../../../app/lib/desktop";
import type {
  OnMyAgentAutomationTaskItem,
  OnMyAgentServerClient,
} from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import { isElectronRuntime } from "../../../app/utils";
import { isDocumentHidden, shouldRunPollTick } from "../../infra/visibility-poll";
import { useLocal } from "../../kernel/local-provider";
import { useWorkspace } from "@/react-app/shell";
import { useStatusToasts } from "../shell-feedback";
import {
  automationPayloadFromTemplate,
  buildPersonalizationPlan,
  planFingerprint,
  rankTemplatesForPlan,
  selectTemplatesToCreate,
  shouldOfferPersonalizationApply,
  writeAppliedPlanFingerprint,
} from "../shared";
import { archiveAssistantTask } from "../shared";
import {
  buildPendingAgentFromRecord,
  createDefaultAgentRegistry,
  refreshExpertPackageQuery,
  useAgentRegistryStore,
} from "../agents";
import {
  automationRunArchiveKey,
  filterOutArchivedRuns,
  groupCompletedRunsByDay,
  partitionAutomationTasks,
  resolvePostRunStatusTab,
  shouldShowAutomationListLoading,
  shouldShowAutomationTemplates,
  type CompletedRunEntry,
} from "./automation-list-model";
import {
  archiveAutomationRunKey,
  readArchivedAutomationRunKeys,
  removeAutomationSessionRecord,
  syncAutomationSessionRecords,
  automationArchivedRunsChangedEvent,
} from "./automation-session-groups";
import {
  createEmptyFormState,
  formStateFromAutomation,
  formStateFromTemplateLocalized,
  selectAgentTemplateById,
  hasAutomationModel,
  intervalMinutes,
  isFormValid,
  onceAt,
  type AutomationFormState,
} from "./automation-form-model";
import {
  getAutomationTemplatesForScene,
  type AutomationScene,
  type AutomationTemplate,
} from "./automation-model";
import { useAutomationPageChrome, type AutomationStatusTab } from "./use-automation-page-chrome";
import type { AutomationDialogMode } from "./automation-page-dialogs";

export type CompletedRun = CompletedRunEntry<OnMyAgentAutomationTaskItem>;

const riskAcceptedStorageKey = "onmyagent.automationFullAccessRiskAccepted.v1";

export function isAutomationStopFailedMessage(message: string): boolean {
  return /automation_stop_failed|stop_failed|Failed to stop|retry stop/i.test(message);
}

export function isAutomationRefreshRequestCurrent(input: {
  requestId: number;
  activeRequestId: number;
  requestClient: unknown;
  activeClient: unknown;
  requestWorkspaceId: string;
  activeWorkspaceId: string;
}) {
  return (
    input.requestId === input.activeRequestId &&
    input.requestClient === input.activeClient &&
    input.requestWorkspaceId === input.activeWorkspaceId
  );
}

export type AutomationPageProps = {
  scene: AutomationScene;
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  focusAutomationId?: string | null;
  onFocusAutomationConsumed?: () => void;
  listOpenCodeCommands?: () => Promise<
    Array<{ id?: string; name: string; description?: string; source?: string }>
  >;
  listSkills?: () => Promise<Array<{ name: string; description?: string; path?: string }>>;
  listMcp?: () => Promise<{ servers: Array<{ name?: string; id?: string }> }>;
  hideStatusTabs?: boolean;
  statusTab?: AutomationStatusTab;
  onStatusTabChange?: (tab: AutomationStatusTab) => void;
  templateViewOpen?: boolean;
  onTemplateViewOpenChange?: (open: boolean) => void;
  createRequestId?: number;
};

export function useAutomationPage(props: AutomationPageProps) {
  const workspace = useWorkspace();
  const local = useLocal();
  const { showToast } = useStatusToasts();
  const registry = useAgentRegistryStore((state) => state.registry) ?? createDefaultAgentRegistry();
  const [automations, setAutomations] = useState<OnMyAgentAutomationTaskItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<AutomationDialogMode>("create");
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const defaultModel = local.prefs.defaultModel ?? null;
  const [form, setForm] = useState<AutomationFormState>(() => createEmptyFormState(defaultModel));
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openBlankDialog = () => {
    setDialogMode("create");
    setEditingAutomationId(null);
    setForm(createEmptyFormState(local.prefs.defaultModel ?? null));
    setDialogOpen(true);
  };
  const { templateViewOpen, setTemplateViewOpen, activeStatusTab, setActiveStatusTab } =
    useAutomationPageChrome({
      statusTab: props.statusTab,
      onStatusTabChange: props.onStatusTabChange,
      templateViewOpen: props.templateViewOpen,
      onTemplateViewOpenChange: props.onTemplateViewOpenChange,
      createRequestId: props.createRequestId,
      onCreateRequest: openBlankDialog,
    });
  const [listReady, setListReady] = useState(false);
  const automationRefreshStateRef = useRef<{
    client: OnMyAgentServerClient | null;
    workspaceId: string;
    inFlight: boolean;
    requestId: number;
  }>({
    client: null,
    workspaceId: "",
    inFlight: false,
    requestId: 0,
  });
  const automationRefreshScopeRef = useRef({
    client: props.client,
    workspaceId: props.workspaceId.trim(),
  });
  // Keep the active scope current during render so an old request resolving
  // between a workspace prop change and its effect cleanup cannot repaint the
  // new workspace with stale automation rows.
  automationRefreshScopeRef.current = {
    client: props.client,
    workspaceId: props.workspaceId.trim(),
  };
  const [archivedRunKeys, setArchivedRunKeys] = useState<string[]>(() =>
    readArchivedAutomationRunKeys(props.workspaceId),
  );
  const [personalizationBannerDismissed, setPersonalizationBannerDismissed] = useState(false);
  const [personalizationNotice, setPersonalizationNotice] = useState<string | null>(null);

  const personalizationPlan = useMemo(() => {
    const profile = local.prefs.onboardingProfile;
    if (!profile || profile.skipped) return null;
    if (
      !profile.roles.length &&
      !profile.industries.length &&
      !profile.tasks.length &&
      !profile.tools.length
    ) {
      return null;
    }
    return buildPersonalizationPlan({
      roles: profile.roles,
      industries: profile.industries,
      tools: profile.tools,
      tasks: profile.tasks,
    });
  }, [local.prefs.onboardingProfile]);

  const sceneTemplates = useMemo(() => getAutomationTemplatesForScene(props.scene), [props.scene]);
  const { recommended: recommendedTemplates, rest: restTemplates } = useMemo(
    () => rankTemplatesForPlan(sceneTemplates, personalizationPlan),
    [sceneTemplates, personalizationPlan],
  );
  const visibleTemplates = useMemo(
    () => [...recommendedTemplates, ...restTemplates],
    [recommendedTemplates, restTemplates],
  );
  const recommendedIdSet = useMemo(
    () => new Set(recommendedTemplates.map((item) => item.id)),
    [recommendedTemplates],
  );
  const showPersonalizationOffer =
    !personalizationBannerDismissed &&
    shouldOfferPersonalizationApply(props.workspaceId, personalizationPlan) &&
    Boolean(personalizationPlan);

  const {
    visible: visibleAutomations,
    scheduled,
    running,
    completed,
  } = useMemo(() => partitionAutomationTasks(automations, props.scene), [automations, props.scene]);
  const visibleCompleted = useMemo(
    () => filterOutArchivedRuns(completed, archivedRunKeys),
    [archivedRunKeys, completed],
  );
  const completedByDay = useMemo(
    () => groupCompletedRunsByDay(visibleCompleted),
    [visibleCompleted],
  );
  const hasAutomations = visibleAutomations.length > 0;
  const statusTabCounts: Record<AutomationStatusTab, number> = {
    tasks: scheduled.length + running.length,
    runs: visibleCompleted.length,
  };
  const showListLoading = shouldShowAutomationListLoading({
    listReady,
    loading,
    hasAutomations,
  });
  const showTemplates = shouldShowAutomationTemplates({
    listReady,
    hasAutomations,
    templateViewOpen,
  });

  const refreshAutomations = async (options?: { silent?: boolean }) => {
    const workspaceId = props.workspaceId.trim();
    const refreshState = automationRefreshStateRef.current;
    if (refreshState.client !== props.client || refreshState.workspaceId !== workspaceId) {
      // A new scope must start immediately even while the old workspace's
      // request is still settling. Its request id invalidates that stale reply.
      refreshState.client = props.client;
      refreshState.workspaceId = workspaceId;
      refreshState.inFlight = false;
      refreshState.requestId += 1;
    }
    if (refreshState.inFlight) return;
    if (!props.client || !workspaceId) {
      setAutomations([]);
      setListReady(true);
      setLoading(false);
      return;
    }
    refreshState.inFlight = true;
    const requestId = ++refreshState.requestId;
    const isCurrentRequest = () => {
      const scope = automationRefreshScopeRef.current;
      return isAutomationRefreshRequestCurrent({
        requestId,
        activeRequestId: refreshState.requestId,
        requestClient: props.client,
        activeClient: scope.client,
        requestWorkspaceId: workspaceId,
        activeWorkspaceId: scope.workspaceId,
      });
    };
    if (!options?.silent) setLoading(true);
    if (!options?.silent) setError(null);
    try {
      const result = await props.client.listAutomations(workspaceId);
      if (!isCurrentRequest()) return;
      setAutomations(result.items);
      syncAutomationSessionRecords(workspaceId, result.items);
      // Background poll recovered — clear transient timeout banners only.
      if (options?.silent) {
        setError((current) => (current && /timed out/i.test(current) ? null : current));
      }
    } catch (cause) {
      if (!isCurrentRequest()) return;
      // Silent polls must not paint a red banner over a still-usable list
      // (e.g. 2s poll while a long run is open).
      if (options?.silent) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message.trim() || t("automation.list_load_failed"));
    } finally {
      if (!isCurrentRequest()) return;
      refreshState.inFlight = false;
      setLoading(false);
      setListReady(true);
    }
  };

  useEffect(() => {
    const client = props.client;
    const workspaceId = props.workspaceId.trim();
    setListReady(false);
    setArchivedRunKeys(readArchivedAutomationRunKeys(props.workspaceId));
    void refreshAutomations();
    return () => {
      const refreshState = automationRefreshStateRef.current;
      if (refreshState.client === client && refreshState.workspaceId === workspaceId) {
        refreshState.requestId += 1;
        refreshState.inFlight = false;
      }
    };
  }, [props.client, props.workspaceId]);
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const delayMs = running.length > 0 ? 2_000 : 15_000;
    const scheduleNextPoll = () => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        timer = null;
        void runPoll();
      }, delayMs);
    };
    const runPoll = async () => {
      try {
        if (!shouldRunPollTick(isDocumentHidden())) return;
        await refreshAutomations({ silent: true });
      } finally {
        scheduleNextPoll();
      }
    };
    scheduleNextPoll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [props.client, props.workspaceId, running.length]);
  useEffect(() => {
    const onArchived = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail;
      if (detail?.workspaceId && detail.workspaceId !== props.workspaceId.trim()) {
        return;
      }
      setArchivedRunKeys(readArchivedAutomationRunKeys(props.workspaceId));
    };
    window.addEventListener(automationArchivedRunsChangedEvent, onArchived);
    return () => {
      window.removeEventListener(automationArchivedRunsChangedEvent, onArchived);
    };
  }, [props.workspaceId]);

  useEffect(() => {
    const focusId = props.focusAutomationId?.trim();
    if (!focusId || loading || busy) return;
    const item = automations.find((entry) => entry.id === focusId) ?? null;
    if (!item) return;
    setDialogMode("edit");
    setEditingAutomationId(item.id);
    setForm(formStateFromAutomation(item, local.prefs.defaultModel ?? null));
    setDialogOpen(true);
    props.onFocusAutomationConsumed?.();
  }, [
    automations,
    busy,
    loading,
    local.prefs.defaultModel,
    props.focusAutomationId,
    props.onFocusAutomationConsumed,
  ]);

  const editingItem = editingAutomationId
    ? (visibleAutomations.find((item) => item.id === editingAutomationId) ?? null)
    : null;

  const openTemplateDialog = (template: AutomationTemplate) => {
    setDialogMode("create");
    setEditingAutomationId(null);
    setForm(formStateFromTemplateLocalized(template, local.prefs.defaultModel ?? null));
    setDialogOpen(true);
  };

  const openEditDialog = (item: OnMyAgentAutomationTaskItem) => {
    setDialogMode("edit");
    setEditingAutomationId(item.id);
    setForm(formStateFromAutomation(item, local.prefs.defaultModel ?? null));
    setDialogOpen(true);
  };

  const payload = () => {
    const interval = intervalMinutes(form);
    const timestamp = onceAt(form);
    const agentTemplate = selectAgentTemplateById(registry, form.agentId);
    const pendingAgent = agentTemplate
      ? buildPendingAgentFromRecord(agentTemplate, registry)
      : null;
    return {
      scene: props.scene,
      title: form.title.trim(),
      prompt: form.prompt.trim(),
      workspaceDirectory: form.workspaceDirectory.trim() || null,
      model: form.model,
      agent: pendingAgent
        ? {
            id: pendingAgent.id,
            name: pendingAgent.name,
            description: pendingAgent.description,
            systemPrompt: pendingAgent.systemPrompt,
            tools: pendingAgent.tools,
            model: pendingAgent.model,
          }
        : null,
      accessMode: form.accessMode === "delegate" ? "default" : form.accessMode,
      schedule: {
        mode: form.frequencyMode,
        day: form.day,
        time: form.time,
        ...(form.frequencyMode === "interval" && interval
          ? {
              intervalMinutes: interval,
              weekdays: form.weekdays,
            }
          : {}),
        // Weekly / biweekly: persist selected weekdays for next-run math.
        ...(form.frequencyMode === "weekly" &&
        (form.day === "weekly" || form.day === "biweekly") &&
        form.weekdays.length > 0
          ? { weekdays: form.weekdays }
          : {}),
        ...(form.frequencyMode === "once" && timestamp ? { onceAt: timestamp } : {}),
      },
      effectiveRange: {
        ...(form.effectiveStartDate ? { startDate: form.effectiveStartDate } : {}),
        ...(form.effectiveEndDate ? { endDate: form.effectiveEndDate } : {}),
      },
    };
  };

  const persistAutomation = () => {
    const workspaceId = props.workspaceId.trim();
    if (!props.client || !workspaceId || !isFormValid(form)) {
      setError(t("automation.server_unavailable"));
      return;
    }
    setBusy(true);
    setError(null);
    const request =
      dialogMode === "edit" && editingAutomationId
        ? props.client.updateAutomation(workspaceId, editingAutomationId, payload())
        : props.client.createAutomation(workspaceId, { ...payload(), enabled: true });
    void request
      .then((result) => {
        setAutomations(result.items);
        syncAutomationSessionRecords(workspaceId, result.items);
        setDialogOpen(false);
        setRiskOpen(false);
        setEditingAutomationId(null);
        setTemplateViewOpen(false);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const submitAutomation = () => {
    if (dialogMode === "edit" || window.localStorage.getItem(riskAcceptedStorageKey) === "1") {
      persistAutomation();
      return;
    }
    setRiskAccepted(false);
    setRiskOpen(true);
  };

  const confirmRiskAndCreate = () => {
    window.localStorage.setItem(riskAcceptedStorageKey, "1");
    persistAutomation();
  };

  const updateItem = (item: OnMyAgentAutomationTaskItem, update: { enabled: boolean }) => {
    if (!props.client || !props.workspaceId.trim()) return;
    setBusy(true);
    void props.client
      .updateAutomation(props.workspaceId, item.id, update)
      .then((result) => {
        setAutomations(result.items);
        syncAutomationSessionRecords(props.workspaceId, result.items);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  /** Stop the in-progress run only — schedule stays enabled for the next tick. */
  const stopRunningItem = (item: OnMyAgentAutomationTaskItem) => {
    if (!props.client || !props.workspaceId.trim()) return;
    setBusy(true);
    void props.client
      .cancelAutomationRun(props.workspaceId, item.id)
      .then((result) => {
        setAutomations(result.items);
        syncAutomationSessionRecords(props.workspaceId, result.items);
        showToast({
          tone: "info",
          title: t("automation.stop_run_done", { title: item.title }),
        });
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        // Keep running state so the user can retry stop (abort failed, lease held).
        refreshAutomations({ silent: true });
        setError(
          isAutomationStopFailedMessage(message)
            ? t("automation.stop_run_failed", { title: item.title })
            : message,
        );
      })
      .finally(() => setBusy(false));
  };

  const deleteItem = (item: OnMyAgentAutomationTaskItem) => {
    if (!props.client || !props.workspaceId.trim()) return;
    setBusy(true);
    void props.client
      .deleteAutomation(props.workspaceId, item.id)
      .then((result) => {
        setAutomations(result.items);
        syncAutomationSessionRecords(props.workspaceId, result.items);
        setDialogOpen(false);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  /** Soft-hide one run from history; archive session for sidebar/archived tasks. */
  const archiveRun = (entry: CompletedRun) => {
    const workspaceId = props.workspaceId.trim();
    if (!workspaceId) return;
    const key = automationRunArchiveKey(entry.task.id, entry.run);
    archiveAutomationRunKey(workspaceId, key);
    setArchivedRunKeys(readArchivedAutomationRunKeys(workspaceId));
    const sessionId = entry.run.sessionId?.trim();
    if (sessionId) {
      // Soft-delete schedule records + assistant archive so the sidebar drops the run.
      removeAutomationSessionRecord(workspaceId, sessionId);
      archiveAssistantTask(workspaceId, {
        sessionId,
        title: entry.task.title,
        directory: entry.run.outputDirectory ?? null,
        archivedAt: Date.now(),
        category: entry.task.scene,
      });
    }
    showToast({
      title: t("automation.archive_success"),
      description: t("automation.archive_success_desc", {
        title: entry.task.title,
      }),
      tone: "success",
    });
  };

  const runNow = (item: OnMyAgentAutomationTaskItem) => {
    if (!props.client || !props.workspaceId.trim()) return;
    if (!hasAutomationModel(item.model) && !hasAutomationModel(item.agent?.model ?? null)) {
      setError(t("automation.model_required_run"));
      setActiveStatusTab("tasks");
      openEditDialog({
        ...item,
        model: item.model ?? local.prefs.defaultModel ?? undefined,
      });
      return;
    }
    setBusy(true);
    setError(null);
    setDialogOpen(false);
    setActiveStatusTab("tasks");
    window.setTimeout(() => refreshAutomations({ silent: true }), 200);
    window.setTimeout(() => refreshAutomations({ silent: true }), 1_200);
    void props.client
      .runAutomation(props.workspaceId, item.id)
      .then((result) => {
        setAutomations(result.items);
        syncAutomationSessionRecords(props.workspaceId, result.items);
        const tab = resolvePostRunStatusTab(result.item);
        if (tab === "running") {
          setActiveStatusTab("tasks");
          return;
        }
        const lastRun = result.item.lastRun;
        if (lastRun?.status === "failed") {
          setActiveStatusTab("runs");
          setError(lastRun.error?.trim() || t("automation.run_failed"));
          return;
        }
        const sessionId = lastRun?.sessionId;
        if (sessionId) props.onOpenSession(props.workspaceId, sessionId);
        setActiveStatusTab("runs");
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        // Server may still be running after a client wait timeout — do not
        // flash a hard error and jump tabs; poll will pick up running state.
        if (/timed out/i.test(message)) {
          showToast({
            tone: "info",
            title: t("automation.run_started_background", { title: item.title }),
          });
          setActiveStatusTab("tasks");
          refreshAutomations({ silent: true });
          return;
        }
        setActiveStatusTab("runs");
        setError(message.trim() || t("automation.run_failed"));
        refreshAutomations({ silent: true });
      })
      .finally(() => setBusy(false));
  };

  const openSession = (sessionId: string) => props.onOpenSession(props.workspaceId, sessionId);

  const applyPersonalization = async () => {
    const plan = personalizationPlan;
    const workspaceId = props.workspaceId.trim();
    if (!plan || !props.client || !workspaceId) return;
    setBusy(true);
    setError(null);
    setPersonalizationNotice(null);
    try {
      const existingTitles = new Set(
        visibleAutomations.map((item) => item.title.trim()).filter(Boolean),
      );
      const toCreate = selectTemplatesToCreate(plan, sceneTemplates, existingTitles)
        .map((template) => {
          const title = t(template.titleKey);
          if (existingTitles.has(title)) return null;
          return template;
        })
        .filter((item): item is AutomationTemplate => Boolean(item));

      let created = 0;
      let lastItems = automations;
      for (const template of toCreate) {
        const payload = automationPayloadFromTemplate(props.scene, template, t);
        const result = await props.client.createAutomation(workspaceId, payload);
        lastItems = result.items;
        created += 1;
        existingTitles.add(t(template.titleKey));
      }
      if (lastItems !== automations) {
        setAutomations(lastItems);
        syncAutomationSessionRecords(workspaceId, lastItems);
      }

      if (plan.defaultAutoInstallExpert && isElectronRuntime()) {
        try {
          await installExpertPackage({
            source: "builtin",
            marketplace: "experts",
            packageName: plan.defaultAutoInstallExpert,
          });
          await refreshExpertPackageQuery();
        } catch {
          // Expert install is best-effort (desktop only); automations still apply.
        }
      }

      writeAppliedPlanFingerprint(workspaceId, planFingerprint(plan));
      setPersonalizationBannerDismissed(true);
      setTemplateViewOpen(false);
      setPersonalizationNotice(t("automation.personalization_applied", { count: created }));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return {
    workspace,
    local,
    registry,
    dialogOpen,
    setDialogOpen,
    dialogMode,
    form,
    setForm,
    riskOpen,
    setRiskOpen,
    riskAccepted,
    setRiskAccepted,
    busy,
    error,
    openBlankDialog,
    templateViewOpen,
    setTemplateViewOpen,
    activeStatusTab,
    setActiveStatusTab,
    personalizationBannerDismissed,
    setPersonalizationBannerDismissed,
    personalizationNotice,
    personalizationPlan,
    recommendedTemplates,
    restTemplates,
    visibleTemplates,
    recommendedIdSet,
    showPersonalizationOffer,
    scheduled,
    running,
    completedByDay,
    hasAutomations,
    statusTabCounts,
    showListLoading,
    showTemplates,
    editingItem,
    openTemplateDialog,
    openEditDialog,
    submitAutomation,
    confirmRiskAndCreate,
    updateItem,
    stopRunningItem,
    deleteItem,
    archiveRun,
    runNow,
    openSession,
    applyPersonalization,
  };
}
