/** @jsxImportSource react */
import { HelpCircle, Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { LIST_LANE_HEADER_CLASS } from "@/components/ui/sidebar-chrome";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "../../../i18n";
import { isElectronRuntime } from "../../../app/utils";
import { planFingerprint, writeAppliedPlanFingerprint } from "../shared";
import { AutomationRunsListBody, AutomationTasksListBody } from "./automation-page-lists";
import {
  AutomationDialog,
  AutomationRiskDialog,
  AutomationTemplateCard,
} from "./automation-page-dialogs";
import {
  isAutomationRefreshRequestCurrent,
  useAutomationPage,
  type AutomationPageProps,
} from "./use-automation-page";
import type { AutomationStatusTab } from "./use-automation-page-chrome";

export { isAutomationRefreshRequestCurrent };
export type { AutomationPageProps };

const automationStatusTabs: AutomationStatusTab[] = ["tasks", "runs"];

export function AutomationPage(props: AutomationPageProps) {
  const {
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
  } = useAutomationPage(props);

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background text-dls-text">
      {/* Template gallery is opened from the left rail — no duplicate chrome. */}
      {showTemplates ? null : (
        // Shared list-lane h-14 strip (sidebar-chrome LIST_LANE_HEADER_CLASS).
        <div className={cn(LIST_LANE_HEADER_CLASS, "justify-between gap-4 px-8")}>
          <h1 className="min-w-0 truncate text-lg font-medium leading-7 text-dls-text">
            {t("automation.title")}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={openBlankDialog}>
              {t("automation.add_with_plus")}
            </Button>
            {hasAutomations ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTemplateViewOpen(true)}
              >
                {t("automation.add_from_template")}
              </Button>
            ) : null}
          </div>
        </div>
      )}

      <div
        className={cn("min-h-0 flex-1 overflow-y-auto px-8 pb-10", showTemplates ? "pt-6" : null)}
      >
        {error ? (
          <NoticeBox tone="error" size="content" className="mb-4">
            {error}
          </NoticeBox>
        ) : null}
        {isElectronRuntime() && local.prefs.keepSystemAwake !== true ? (
          <NoticeBox
            tone="info"
            size="content"
            className="mb-4 flex items-center justify-between gap-4"
            role="status"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Info className="size-4 shrink-0" aria-hidden />
              <p className="min-w-0 text-sm font-medium leading-5">
                {t("automation.keep_awake_banner")}
              </p>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2.5 text-sm font-medium">
              <span>{t("automation.keep_awake_toggle")}</span>
              <Switch
                size="sm"
                checked={false}
                onCheckedChange={(enabled) => {
                  if (!enabled) return;
                  local.setPrefs((previous) => ({
                    ...previous,
                    keepSystemAwake: true,
                  }));
                }}
                aria-label={t("automation.keep_awake_toggle")}
              />
            </label>
          </NoticeBox>
        ) : null}
        {personalizationNotice ? (
          <NoticeBox tone="info" size="content" className="mb-4">
            {personalizationNotice}
          </NoticeBox>
        ) : null}
        {showPersonalizationOffer && personalizationPlan ? (
          <NoticeBox tone="info" size="content" className="mb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium text-dls-text">
                  {t("automation.personalization_title")}
                </div>
                <p className="text-xs leading-5 text-dls-secondary">
                  {t("automation.personalization_desc", {
                    count: personalizationPlan.defaultAutoCreateTemplateIds.length,
                  })}
                </p>
                {personalizationPlan.defaultAutoInstallExpert ? (
                  <p className="text-xs text-dls-secondary">
                    {t("automation.personalization_expert", {
                      name: personalizationPlan.defaultAutoInstallExpert,
                    })}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void applyPersonalization()}
                  disabled={busy || !props.client}
                >
                  {busy ? <LoadingSpinner /> : null}
                  {t("automation.personalization_apply")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPersonalizationBannerDismissed(true);
                    if (personalizationPlan) {
                      writeAppliedPlanFingerprint(
                        props.workspaceId,
                        planFingerprint(personalizationPlan),
                      );
                    }
                  }}
                >
                  {t("automation.personalization_dismiss")}
                </Button>
              </div>
            </div>
          </NoticeBox>
        ) : null}
        {showListLoading ? (
          <div className="mb-4 flex items-center gap-2 text-sm leading-none text-dls-secondary">
            <LoadingSpinner className="size-4 shrink-0" />
            <span className="leading-5">{t("automation.loading")}</span>
          </div>
        ) : null}

        {showTemplates ? (
          <div className="space-y-5">
            {/* Same page-header pattern as messaging channels. */}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-medium leading-7 text-dls-text">
                  {t("automation.nav_templates")}
                </h2>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          className="text-dls-secondary transition-colors hover:text-dls-text"
                          aria-label={t("automation.templates_help_title")}
                        >
                          <HelpCircle className="size-4" />
                        </button>
                      }
                    />
                    <TooltipContent side="bottom" className="max-w-sm">
                      <div className="space-y-1.5 text-xs">
                        <div className="font-medium">{t("automation.templates_help_title")}</div>
                        <p className="text-dls-secondary">{t("automation.templates_help_body")}</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <p className="mt-1 text-sm leading-6 text-dls-secondary">
                {t("automation.templates_desc")}
              </p>
            </div>
            {recommendedTemplates.length > 0 ? (
              <section>
                <h3 className="text-sm font-medium text-dls-text">
                  {t("automation.personalization_recommended")}
                </h3>
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                  {recommendedTemplates.map((template) => (
                    <AutomationTemplateCard
                      key={template.id}
                      template={template}
                      recommended
                      onSelect={openTemplateDialog}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            <section>
              <h3 className="text-sm font-medium text-dls-text">
                {recommendedTemplates.length > 0
                  ? t("automation.personalization_all_templates")
                  : t("automation.start_from_template")}
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {(recommendedTemplates.length > 0 ? restTemplates : visibleTemplates).map(
                  (template) => (
                    <AutomationTemplateCard
                      key={template.id}
                      template={template}
                      recommended={recommendedIdSet.has(template.id)}
                      onSelect={openTemplateDialog}
                    />
                  ),
                )}
              </div>
            </section>
          </div>
        ) : (
          <section className="space-y-4">
            {props.hideStatusTabs ? null : (
              <SegmentedTabGroup density="bare">
                {automationStatusTabs.map((tab) => (
                  <NavTabButton
                    key={tab}
                    type="button"
                    active={activeStatusTab === tab}
                    size="tab"
                    shape="tab"
                    aria-pressed={activeStatusTab === tab}
                    onClick={() => setActiveStatusTab(tab)}
                  >
                    <span>
                      {tab === "tasks" ? t("automation.tab_tasks") : t("automation.tab_runs")}
                    </span>
                    <span
                      className={
                        activeStatusTab === tab
                          ? "tabular-nums text-xs font-medium opacity-70"
                          : "tabular-nums text-xs font-medium text-dls-secondary"
                      }
                    >
                      {statusTabCounts[tab]}
                    </span>
                  </NavTabButton>
                ))}
              </SegmentedTabGroup>
            )}
            <div className="space-y-3">
              {activeStatusTab === "tasks" ? (
                <AutomationTasksListBody
                  running={running}
                  scheduled={scheduled}
                  taskCount={statusTabCounts.tasks}
                  busy={busy}
                  onOpenSession={openSession}
                  onStop={stopRunningItem}
                  onEdit={openEditDialog}
                  onRunNow={runNow}
                  onToggleEnabled={(task) => updateItem(task, { enabled: !task.enabled })}
                  onDelete={deleteItem}
                />
              ) : null}
              {activeStatusTab === "runs" ? (
                <AutomationRunsListBody
                  running={running}
                  completedByDay={completedByDay}
                  runCount={statusTabCounts.runs}
                  busy={busy}
                  onOpenSession={openSession}
                  onStop={stopRunningItem}
                  onArchive={archiveRun}
                  onDelete={deleteItem}
                />
              ) : null}
            </div>
          </section>
        )}
      </div>

      <AutomationDialog
        open={dialogOpen}
        mode={dialogMode}
        form={form}
        item={editingItem}
        registry={registry}
        client={props.client}
        workspaceId={props.workspaceId}
        workspaceRoot={workspace.selectedWorkspaceRoot}
        listOpenCodeCommands={props.listOpenCodeCommands}
        listSkills={props.listSkills}
        listMcp={props.listMcp}
        onOpenChange={setDialogOpen}
        onFormChange={setForm}
        onSubmit={submitAutomation}
        onDelete={() => {
          if (editingItem) deleteItem(editingItem);
        }}
        onRunNow={() => {
          if (editingItem) runNow(editingItem);
        }}
        onToggleEnabled={() => {
          if (editingItem) updateItem(editingItem, { enabled: !editingItem.enabled });
        }}
        busy={busy}
      />
      <AutomationRiskDialog
        open={riskOpen}
        accepted={riskAccepted}
        onAcceptedChange={setRiskAccepted}
        onOpenChange={setRiskOpen}
        onConfirm={confirmRiskAndCreate}
      />
    </div>
  );
}
