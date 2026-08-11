/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronsLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { NoticeBox } from "@/components/ui/notice-box";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type {
  AgentRegistry,
  AgentRecord,
  AgentSkillItem,
  AgentWizardDraft,
} from "./agent-registry";
import {
  createBlankWizardDraft,
  createDefaultAgentRegistry,
  createWizardDraftFromAgent,
} from "./agent-registry";
import { findSkillMarkdownFile, readSkillMarkdown } from "./skill-package-import";
import {
  expertCreationSkillKey,
  materializeExpertCreationMarketplaceSkill,
} from "./expert-creation-skill-picker-model";
import { EXPERT_CREATION_VISIBLE_TABS } from "./expert-creation-tabs-model";
import { ExpertCreationExitDialog } from "./expert-creation-exit-dialog";
import { hasExpertCreationProgress } from "./expert-creation-lifecycle";
import {
  clearExpertCreationStoredState,
  EMPTY_EXPERT_COACH_STATE,
  readExpertCreationStoredState,
  writeExpertCreationStoredState,
} from "./expert-creation-draft-storage";
import {
  beginExpertCreateSaveAttempt,
  consumeExpertCreateComposerFlush,
} from "./expert-creation-flush";
import { mergeExpertDraftSuggestion } from "./expert-creation-suggestions";
import { deleteExpertCreationEphemeralSession } from "./expert-creation-ephemeral-sessions";
import { BUILTIN_MARKETPLACE_SKILLS } from "../plugins";
import {
  installBuiltinSkillPackage,
  listLocalSkills,
  stageMyExpertKnowledge,
} from "../../../app/lib/desktop";
import { isElectronRuntime } from "../../../app/utils";
import type {
  ExpertCreationPageProps,
  ExpertCreationTab,
  ExpertKnowledgeEntry,
} from "./expert-creation-types";
export type {
  ExpertCreationPageProps,
  ExpertCreationTab,
  ExpertKnowledgeEntry,
  ExpertKnowledgeNode,
} from "./expert-creation-types";
import { EXPERT_FORM_SECTION_CLASS } from "./expert-creation-view-constants";
import { PromptEditor, BasicInfoPanel } from "./expert-creation-basic-tab";
import { SkillsPanel } from "./expert-creation-skills-tab";
import { KnowledgePanel } from "./expert-creation-knowledge-tab";
import { ExpertCoach, TryEffectPanel } from "./expert-creation-coach-preview";

export {
  joinKnowledgePath,
  listKnowledgeChildren,
  removeKnowledgeNode,
} from "./expert-creation-knowledge-tab";

async function encodeKnowledgeFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

const TABS: Array<{ id: ExpertCreationTab; label: string }> = EXPERT_CREATION_VISIBLE_TABS.map((id) => ({
  id,
  label: `agents.expert_creation_${id}`,
}));

const EXPERT_CREATION_MARKETPLACE_SKILLS: AgentSkillItem[] =
  BUILTIN_MARKETPLACE_SKILLS.map((skill) => ({
    id: `marketplace:${skill.id}`,
    category: skill.categoryLabel,
    group: "marketplace",
    name: skill.skillName,
    description: skill.description,
    enabled: true,
    displayNameEn: skill.displayName,
    descriptionEn: skill.description,
  }));

const BUILTIN_MARKETPLACE_SKILL_BY_NAME = new Map(
  BUILTIN_MARKETPLACE_SKILLS.map((skill) => [skill.skillName, skill]),
);

function buildInitialDraft(
  registry: AgentRegistry | null,
  skills: AgentSkillItem[],
  editingAgent?: AgentRecord | null,
) {
  if (editingAgent) {
    const draft = createWizardDraftFromAgent(editingAgent, skills);
    return {
      ...draft,
      // Keep custom/local skill IDs until the async skill scan finishes.
      skillIds: [...editingAgent.skillIds],
    };
  }
  const source = registry ?? createDefaultAgentRegistry();
  const blank = createBlankWizardDraft(source, skills);
  return {
    ...blank,
    avatarOptionId: blank.avatarOptionId || source.avatars[0]?.id || "",
  };
}

type LocalSkillSummary = {
  name: string;
  path?: string;
  description?: string;
  displayNameEn?: string;
  descriptionEn?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalSkillSummary(value: unknown): value is LocalSkillSummary {
  if (!isRecord(value) || typeof value.name !== "string") return false;
  return (
    value.path === undefined || typeof value.path === "string"
  ) && (
    value.description === undefined || typeof value.description === "string"
  ) && (
    value.displayNameEn === undefined || typeof value.displayNameEn === "string"
  ) && (
    value.descriptionEn === undefined || typeof value.descriptionEn === "string"
  );
}
export function ExpertCreationPage(props: ExpertCreationPageProps) {
  const sourceRegistry = props.registry ?? createDefaultAgentRegistry();
  const [baselineDraft] = useState(() =>
    buildInitialDraft(props.registry, props.skills, props.editingAgent),
  );
  const [activeTab, setActiveTab] = useState<ExpertCreationTab>("basic");
  const showModelPicker = activeTab !== "knowledge";
  const [storedInitialState] = useState(() => readExpertCreationStoredState(
    props.workspaceId,
    baselineDraft,
  ));
  const initialState = props.editingAgent
    ? {
        draft: baselineDraft,
        coach: EMPTY_EXPERT_COACH_STATE,
      }
    : storedInitialState;
  const [draft, setDraft] = useState(initialState.draft);
  const [initialRetainedCoachSessionId] = useState(
    initialState.coach.sessionId,
  );
  const [coachSessionId, setCoachSessionId] = useState(
    initialState.coach.sessionId,
  );
  const [availableSkills, setAvailableSkills] = useState(() =>
    props.skills.filter((skill) => skill.enabled),
  );
  const [knowledge, setKnowledge] = useState<ExpertKnowledgeEntry[]>([]);
  const [draftPackageId] = useState(() => `draft-${crypto.randomUUID()}`);
  const [knowledgeStaging, setKnowledgeStaging] = useState(false);
  const [tryOpen, setTryOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsLoadError, setSkillsLoadError] = useState(false);
  const [skillsReloadToken, setSkillsReloadToken] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (props.editingAgent) return;
    writeExpertCreationStoredState(props.workspaceId, {
      draft,
      coach: {
        ...EMPTY_EXPERT_COACH_STATE,
        sessionId: initialRetainedCoachSessionId,
      },
    });
  }, [draft, initialRetainedCoachSessionId, props.editingAgent, props.workspaceId]);

  useEffect(() => {
    let cancelled = false;
    const loadSkills = async () => {
      setSkillsLoading(true);
      setSkillsLoadError(false);
      let localSkills: LocalSkillSummary[] = [];
      let attempted = false;
      let succeeded = false;
      if (props.client && props.workspaceId.trim()) {
        attempted = true;
        try {
          const result = await props.client.listSkills(props.workspaceId, {
            includeGlobal: true,
          });
          succeeded = true;
          localSkills = result.items.map((entry) => ({
            name: entry.name,
            path: entry.path,
            description: entry.description,
            displayNameEn: entry.displayNameEn,
            descriptionEn: entry.descriptionEn,
          }));
        } catch {
          localSkills = [];
        }
      }
      if (localSkills.length === 0 && isElectronRuntime() && props.workspaceRoot.trim()) {
        attempted = true;
        try {
          const result: unknown = await listLocalSkills(props.workspaceRoot);
          succeeded = true;
          const entries: unknown[] = Array.isArray(result) ? result : [];
          localSkills = entries.filter(isLocalSkillSummary);
        } catch {
          localSkills = [];
        }
      }
      if (cancelled) return;
      const localByName = new Map(localSkills.map((skill) => [skill.name, skill]));
      const merged = props.skills.map((skill) => {
        const local = localByName.get(skill.name);
        return {
          ...skill,
          enabled: skill.enabled || Boolean(local),
          path: local?.path ?? skill.path,
          description: local?.description ?? skill.description,
          displayNameEn: local?.displayNameEn ?? skill.displayNameEn,
          descriptionEn: local?.descriptionEn ?? skill.descriptionEn,
        };
      });
      const knownNames = new Set(merged.map((skill) => skill.name));
      for (const local of localSkills) {
        if (knownNames.has(local.name)) continue;
        merged.push({
          id: local.name,
          category: "installed",
          group: "",
          name: local.name,
          description: local.description ?? local.name,
          enabled: true,
          path: local.path,
          displayNameEn: local.displayNameEn,
          descriptionEn: local.descriptionEn,
        });
      }
      setAvailableSkills(merged.filter((skill) => skill.enabled));
      setSkillsLoadError(attempted && !succeeded);
      setSkillsLoading(false);
    };
    void loadSkills();
    return () => {
      cancelled = true;
    };
  }, [props.client, props.skills, props.workspaceId, props.workspaceRoot, skillsReloadToken]);

  const setDraftField = <K extends keyof AgentWizardDraft>(
    key: K,
    value: AgentWizardDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const importSkillPackage = async (files: File[]) => {
    const skillFile = findSkillMarkdownFile(files);
    if (!skillFile) return;
    if (!props.client || !props.workspaceId.trim()) {
      setSubmitError(t("agents.expert_creation_import_failed"));
      return;
    }
    setImporting(true);
    try {
      const skill = await readSkillMarkdown(skillFile);
      const result = await props.client.upsertSkill(props.workspaceId, skill);
      const importedSkill: AgentSkillItem = {
        id: skill.name,
        category: "installed",
        group: "",
        name: skill.name,
        description: skill.description ?? skill.name,
        enabled: true,
        path: result.path,
      };
      setAvailableSkills((current) => [
        importedSkill,
        ...current.filter((item) => item.id !== importedSkill.id),
      ]);
      setDraft((current) => ({
        ...current,
        skillIds: current.skillIds.includes(importedSkill.id)
          ? current.skillIds
          : [...current.skillIds, importedSkill.id],
      }));
      setActiveTab("skills");
      setSubmitError(null);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("agents.expert_creation_import_failed"));
    } finally {
      setImporting(false);
    }
  };

  const installMarketplaceSkill = async (marketplaceSkill: AgentSkillItem) => {
    const skillKey = expertCreationSkillKey(marketplaceSkill);
    const catalogSkill = BUILTIN_MARKETPLACE_SKILL_BY_NAME.get(skillKey);
    if (!catalogSkill) {
      setSubmitError(t("agents.expert_creation_install_skill_failed"));
      return;
    }
    const existingSkill = availableSkills.find(
      (skill) => expertCreationSkillKey(skill) === skillKey,
    );
    if (existingSkill) {
      setDraft((current) => ({
        ...current,
        skillIds: current.skillIds.includes(existingSkill.id)
          ? current.skillIds
          : [...current.skillIds, existingSkill.id],
      }));
      return;
    }
    if (installingSkillId === skillKey) return;
    setInstallingSkillId(skillKey);
    setSubmitError(null);
    try {
      if (!isElectronRuntime()) {
        throw new Error(t("agents.expert_creation_install_skill_failed"));
      }
      const result = await installBuiltinSkillPackage({
        source: "builtin",
        packageName: catalogSkill.packageName,
        skillName: catalogSkill.skillName,
      });
      const installedSkill = materializeExpertCreationMarketplaceSkill(
        marketplaceSkill,
        result.path,
      );
      setAvailableSkills((current) => {
        if (current.some((skill) => expertCreationSkillKey(skill) === skillKey)) {
          return current;
        }
        return [installedSkill, ...current];
      });
      setDraft((current) => ({
        ...current,
        skillIds: current.skillIds.includes(installedSkill.id)
          ? current.skillIds
          : [...current.skillIds, installedSkill.id],
      }));
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : t("agents.expert_creation_install_skill_failed"),
      );
    } finally {
      setInstallingSkillId(null);
    }
  };

  const updateKnowledge = async (next: ExpertKnowledgeEntry[]) => {
    if (!isElectronRuntime()) {
      setKnowledge(next);
      return;
    }
    setKnowledgeStaging(true);
    try {
      const stagedEntries = await Promise.all(next.map(async (entry) => {
        if (!entry.file) {
          return { kind: entry.kind, relativePath: entry.relativePath };
        }
        const sourcePath = window.__ONMYAGENT_ELECTRON__?.files?.getPathForFile?.(entry.file) ?? "";
        return {
          kind: entry.kind,
          relativePath: entry.relativePath,
          ...(sourcePath
            ? { sourcePath }
            : { dataBase64: await encodeKnowledgeFile(entry.file) }),
        };
      }));
      const result = await stageMyExpertKnowledge({
        draftId: draftPackageId,
        knowledge: stagedEntries,
      });
      setKnowledge(next.map((entry) => ({
        ...entry,
        stagedPath: `${result.path}/${entry.relativePath}`,
      })));
      setSubmitError(null);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("agents.expert_creation_knowledge_stage_failed"));
    } finally {
      setKnowledgeStaging(false);
    }
  };

  const submit = async () => {
    if (submitting) return;
    if (!draft.name.trim()) {
      setSubmitError(t("agents.expert_creation_name_required"));
      setActiveTab("basic");
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      // Lifecycle: at most one create-path draft flush per save attempt.
      beginExpertCreateSaveAttempt();
      await props.onDone(
        draft,
        knowledge,
        availableSkills,
        draftPackageId,
        coachSessionId,
      );
      if (
        !props.editingAgent &&
        consumeExpertCreateComposerFlush()
      ) {
        // Real flush: clear persisted creation draft/composer state once.
        clearExpertCreationStoredState(props.workspaceId);
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : t(
              props.editingAgent
                ? "agents.expert_creation_update_failed"
                : "agents.expert_creation_create_failed",
            ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const requestClose = () => {
    if (submitting) return;
    if (hasExpertCreationProgress(
      draft,
      baselineDraft,
      { ...EMPTY_EXPERT_COACH_STATE, sessionId: coachSessionId },
      knowledge.length,
    )) {
      setExitDialogOpen(true);
      return;
    }
    props.onClose();
  };

  const discardAndClose = () => {
    if (!props.editingAgent) {
      clearExpertCreationStoredState(props.workspaceId);
    }
    if (!props.editingAgent && isElectronRuntime()) {
      void stageMyExpertKnowledge({ draftId: draftPackageId, discard: true });
    }
    if (!props.editingAgent && coachSessionId && props.client) {
      void deleteExpertCreationEphemeralSession({
        client: props.client,
        workspaceId: props.workspaceId,
        workspaceRoot: props.workspaceRoot,
        sessionId: coachSessionId,
      }).catch((error) => {
        console.warn("[expert-creation] failed to delete discarded coach session", error);
      });
    }
    setExitDialogOpen(false);
    props.onClose();
  };

  const selectedIds = draft.skillIds;

  return (
    <div className="absolute inset-0 z-50 flex min-h-0 flex-col bg-dls-surface-solid text-dls-text">
      {/*
        Full-screen overlay covers the global mac body::before drag strip.
        Header must own mac:titlebar-drag so empty chrome can move the window;
        buttons already use titlebar-no-drag via the Button primitive.
      */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-dls-border bg-dls-surface px-5 mac:titlebar-drag">
        <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={requestClose}>
          <ArrowLeft data-icon="inline-start" className="size-4" />
          {t("agents.expert_creation_back")}
        </Button>
        <h1 className="pointer-events-none text-base font-semibold tracking-tight text-dls-text">
          {props.editingAgent
            ? t("agents.expert_creation_edit_title")
            : t("agents.expert_creation_title")}
        </h1>
        <div className="flex items-center gap-2 mac:titlebar-no-drag">
          <Button
            type="button"
            size="sm"
            className="disabled:bg-dls-surface-muted disabled:text-dls-secondary"
            aria-busy={submitting}
            disabled={!draft.name.trim() || submitting}
            onClick={() => void submit()}
          >
            {submitting
              ? props.editingAgent
                ? t("agents.expert_creation_updating")
                : t("agents.expert_creation_saving")
              : props.editingAgent
                ? t("agents.expert_creation_update")
                : t("agents.expert_creation_done")}
          </Button>
        </div>
      </header>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 gap-1 bg-dls-background p-4">
        <ResizablePanel defaultSize="36%" minSize="320px" maxSize="48%" className="min-w-0">
          <ExpertCoach
            draft={draft}
            registry={sourceRegistry}
            workspaceRoot={props.workspaceRoot}
            opencodeBaseUrl={props.opencodeBaseUrl}
            onmyagentServerToken={props.onmyagentServerToken}
            selectedModel={props.selectedModel}
            renderCoachPanel={props.renderCoachPanel}
            renderComposer={props.renderComposer}
            showModelPicker={showModelPicker}
            initialSessionId={coachSessionId}
            onSessionIdChange={setCoachSessionId}
            onApplyDraftSuggestion={(suggestion, options) => {
              let appliedCount = 0;
              setDraft((current) => {
                const merged = mergeExpertDraftSuggestion(
                  current,
                  suggestion,
                  options.mode,
                );
                appliedCount = merged.appliedKeys.length;
                return merged.draft;
              });
              if (appliedCount <= 0) return;
              setActiveTab("basic");
              props.showToast?.({
                title:
                  options.mode === "empty-only"
                    ? t("agents.expert_creation_suggestion_synced")
                    : t("agents.expert_creation_suggestion_applied_toast"),
                description: "",
                tone: "success",
                durationMs: 3200,
              });
            }}
          />
        </ResizablePanel>
        <ResizableHandle
          withHandle
          aria-label={t("agents.expert_creation_resize_coach")}
          className="w-2"
        />
        <ResizablePanel minSize="440px" className="min-w-0">
        <main className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-dls-border/40 bg-dls-surface">
          {/* Fixed h-14 matches coach panel chrome so dual-pane tops line up. */}
          <div className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-dls-border/70 bg-dls-surface px-5">
            <span aria-hidden />
            {/* density=bare: free-float pills like Files (files/tasks/experts), not the filter track sausage. */}
            <SegmentedTabGroup
              density="bare"
              aria-label={t("agents.expert_creation_title")}
            >
              {TABS.map((tab) => (
                <NavTabButton
                  key={tab.id}
                  type="button"
                  size="tab"
                  shape="tab"
                  active={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {t(tab.label)}
                </NavTabButton>
              ))}
            </SegmentedTabGroup>
            {!tryOpen ? (
              <Button type="button" variant="outline" size="sm" className="justify-self-end gap-1.5" onClick={() => setTryOpen(true)}>
                <ChevronsLeft data-icon="inline-start" className="size-4" />
                {t("agents.expert_creation_try")}
              </Button>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1">
            <section className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="h-full min-h-0 w-full">
                {submitError ? (
                  <NoticeBox role="alert" tone="error" size="content" className="mb-5">
                    {submitError}
                  </NoticeBox>
                ) : null}
                {activeTab === "basic" ? (
                  <BasicInfoPanel
                    draft={draft}
                    registry={sourceRegistry}
                    compact={tryOpen}
                    onDraftChange={setDraftField}
                  />
                ) : null}
                {activeTab === "memory" ? (
                  <section
                    className={cn(
                      "flex h-full min-h-0 flex-col",
                      EXPERT_FORM_SECTION_CLASS,
                    )}
                  >
                    <div className="mb-3 shrink-0">
                      <h3 className="text-base font-semibold leading-6 text-dls-text">
                        {t("agents.expert_creation_memory")}
                      </h3>
                      <p className="mt-1 max-w-[52ch] text-sm leading-6 text-dls-secondary">
                        {t("agents.expert_creation_memory_desc")}
                      </p>
                    </div>
                    <PromptEditor
                      value={draft.agentMemory}
                      onChange={(value) => setDraftField("agentMemory", value)}
                      placeholder={t("agents.expert_creation_memory_placeholder")}
                      ariaLabel={t("agents.expert_creation_memory")}
                    />
                  </section>
                ) : null}
                {activeTab === "skills" ? (
                  <SkillsPanel
                    skills={availableSkills}
                    marketplaceSkills={EXPERT_CREATION_MARKETPLACE_SKILLS}
                    selectedIds={selectedIds}
                    onSelectedIdsChange={(ids) => setDraftField("skillIds", ids)}
                    onInstallMarketplaceSkill={(skill) => void installMarketplaceSkill(skill)}
                    installingSkillId={installingSkillId}
                    onImport={(files) => void importSkillPackage(files)}
                    importing={importing}
                    loading={skillsLoading}
                    loadError={skillsLoadError}
                    onRetryLoad={() => setSkillsReloadToken((current) => current + 1)}
                  />
                ) : null}
                {activeTab === "knowledge" ? (
                  <KnowledgePanel
                    entries={knowledge}
                    staging={knowledgeStaging}
                    onEntriesChange={updateKnowledge}
                  />
                ) : null}
              </div>
            </section>
          </div>
        </main>
        </ResizablePanel>
        {tryOpen ? (
          <>
            <ResizableHandle
              withHandle
              aria-label={t("agents.expert_creation_resize_preview")}
              className="w-2"
            />
            <ResizablePanel defaultSize="25%" minSize="280px" maxSize="42%" className="min-w-0">
              <TryEffectPanel
                draft={draft}
                knowledge={knowledge}
                registry={sourceRegistry}
                showModelPicker={showModelPicker}
                workspaceRoot={props.workspaceRoot}
                opencodeBaseUrl={props.opencodeBaseUrl}
                onmyagentServerToken={props.onmyagentServerToken}
                selectedModel={props.selectedModel}
                renderPreviewPanel={props.renderPreviewPanel}
                renderComposer={props.renderComposer}
                onClose={() => setTryOpen(false)}
              />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
      <ExpertCreationExitDialog
        open={exitDialogOpen}
        hasKnowledge={knowledge.length > 0}
        onContinue={() => setExitDialogOpen(false)}
        onKeepAndExit={() => {
          writeExpertCreationStoredState(props.workspaceId, {
            draft,
            coach: {
              ...EMPTY_EXPERT_COACH_STATE,
              sessionId: coachSessionId,
            },
          });
          setExitDialogOpen(false);
          props.onClose();
        }}
        onDiscardAndExit={discardAndClose}
      />
    </div>
  );
}
