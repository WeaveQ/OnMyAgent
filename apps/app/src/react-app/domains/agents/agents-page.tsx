import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserRoundPlus,
  X,
} from "lucide-react";

import {
  OnMyAgentServerClient,
  OnMyAgentServerError,
} from "../../../app/lib/onmyagent-server";
import { isElectronRuntime } from "../../../app/utils";
import {
  listLocalSkills,
  pickDirectory,
  readUserAgentRegistry,
  writeMyExpertPackage,
  writeUserAgentRegistry,
} from "../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { ActionRowButton, IconTile, NavListButton } from "@/components/ui/action-row";
import { NoticeBox } from "@/components/ui/notice-box";
import { BadgeDot, StatusBadge } from "@/components/ui/status-badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { useStatusToasts } from "../shell-feedback";
import { SelectMenu } from "../../design-system/select-menu";
import {
  AGENT_AVATAR_STYLES,
  AGENT_MODEL_OPTIONS,
  AGENT_REGISTRY_PATH,
  LEGACY_AGENT_REGISTRY_PATH,
  AGENT_TONES,
  AGENT_TOOL_CATALOG,
  agentAvatarStyleLabel,
  agentToneLabel,
  createAgentRecordFromDraft,
  createBlankWizardDraft,
  createDefaultAgentRegistry,
  createAgentRegistryWithUserAgents,
  createWizardDraftFromAgent,
  createWizardDraftFromTemplate,
  localizedSkillCategoryLabel,
  parseAgentRegistry,
  parseUserAgentRegistry,
  serializeAgentRegistry,
  serializeUserAgentRegistry,
  USER_AGENT_REGISTRY_DISPLAY_PATH,
  type AgentAvatarOption,
  type AgentModelProvider,
  type AgentRecord,
  type AgentRegistry,
  type AgentSkillItem,
  type AgentTemplate,
  type AgentWizardDraft,
} from "./agent-registry";
import { cn } from "@/lib/utils";
import {
  ensureProviderListQuery,
  getConnectedProviderItems,
} from "../connections";
import type { ProviderListItem } from "../../../app/types";
import { useAgentRegistryStore } from "./agent-registry-store";
import {
  classifySkillScope,
  SKILL_SCOPE_LABELS,
  type SkillScope,
} from "../plugins";
import { resolveBundledSkillDisplay } from "../plugins";
import { SelectionMark } from "./agents-selection-mark";
import { renderAvatar, renderGeneratedAvatar } from "./agents-avatar-rendering";
import { TemplateTile, ToolCategoryCard } from "./agents-wizard-cards";
import { PickerChip, StepProgress } from "./agents-wizard-controls";
import {
  AVATARS_PER_STYLE,
  STEP_TITLE,
  buildGroupedSkills,
  buildVisibleAvatarOptions,
  describeRequestError,
  isAgentTemplateVisible,
  isAgentTemplateWizardVisible,
  nextStep,
  nextStepTitle,
  normalizeAgentCardItem,
  previousStep,
  readWorkspaceFileUpdatedAt,
  type AgentCardItem,
  type WizardStep,
} from "./agents-page-model";
import { CreateAgentWizard } from "./create-agent-wizard";
export { CreateAgentWizard } from "./create-agent-wizard";

export type { AgentCardItem } from "./agents-page-model";

export type AgentsPageProps = {
  workspaceId: string;
  workspaceRoot: string;
  client: OnMyAgentServerClient | null;
  providers?: ProviderListItem[];
  connectedProviderIds?: string[];
  initialEditingAgentId?: string | null;
  editRequestKey?: number;
  initialCreateRequestKey?: number;
  /**
   * Called when the user clicks the "对话" button on any agent card
   * (both custom and template). The registry is passed along so the
   * parent can resolve the avatar URL using the same option lookup
   * logic as the agents page.
   * The parent (SessionPage) uses this to switch to the "+新任务" view and
   * prime the session with the selected agent's persona/system prompt.
   */
  onStartConversation?: (item: AgentCardItem, registry: AgentRegistry) => void;
  dialogOnly?: boolean;
};

type RegistryState = {
  registry: AgentRegistry | null;
  updatedAt: number | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

import { agentsLayoutClass, agentsTextClass } from "./agents-page-styles";

function AgentCard(props: {
  registry: AgentRegistry | null;
  runtimeRegistry: AgentRegistry | null;
  item: AgentCardItem;
  onAction: (title: string) => void;
  onStartConversation?: (item: AgentCardItem, registry: AgentRegistry) => void;
  onEdit?: (item: AgentCardItem) => void;
  onDelete?: (item: AgentCardItem) => void;
}) {
  const normalized = normalizeAgentCardItem(props.item);

  return (
    <article
      className={cn(
        agentsLayoutClass.card,
        props.onEdit && agentsLayoutClass.cardInteractive,
      )}
      onClick={() => {
        if (props.onEdit) {
          props.onEdit(props.item);
        }
      }}
    >
      {props.item.kind === "custom" && props.onDelete ? (
        <Button variant="ghost" size="icon-xs"
          type="button"
          className={agentsLayoutClass.deleteButton}
          onClick={(e) => {
            e.stopPropagation();
            props.onDelete?.(props.item);
          }}
          title={t("agents.delete_agent")}
        >
          <Trash2 className="size-3.5" />
        </Button>
      ) : null}
      <div className="flex justify-center">
        {renderAvatar(
          props.registry,
          {
            avatarStyle: normalized.avatarStyle,
            avatarOptionId: normalized.avatarOptionId,
            customAvatarDataUrl: normalized.customAvatarDataUrl,
            name: normalized.name,
          },
          "size-16 text-2xl",
        )}
      </div>
      <div className="mt-3 text-center">
        <h3 className={agentsTextClass.cardTitle}>
          {normalized.name}
        </h3>
        <p className={agentsTextClass.cardDescription}>
          {normalized.description}
        </p>
      </div>
      <div
        className="mt-auto space-y-2 pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <Button variant="default" size="default"
          type="button"
          className={agentsLayoutClass.primaryCardAction}
          onClick={() => {
            if (props.onStartConversation && props.runtimeRegistry) {
              props.onStartConversation(props.item, props.runtimeRegistry);
            } else {
              props.onAction(t("agents.action_conversation_target", { name: normalized.name }));
            }
          }}
        >
          <Plus className="size-3" />
          {t("agents.conversation")}
        </Button>
        <Button variant="ghost" size="sm"
          type="button"
          className={agentsLayoutClass.secondaryCardAction}
          onClick={() => props.onAction(t("agents.action_create_team_target", { name: normalized.name }))}
        >
          <UserRoundPlus className="size-3.5" />
          {t("agents.create_team")}
        </Button>
      </div>
    </article>
  );
}

function EmptyHint(props: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className={agentsLayoutClass.emptyHint}>
      <div className="flex size-16 items-center justify-center rounded-xl bg-dls-hover text-dls-secondary">
        {props.icon}
      </div>
      <div className={agentsTextClass.emptyTitle}>
        {props.title}
      </div>
      <div className={agentsTextClass.emptyDescription}>
        {props.body}
      </div>
    </div>
  );
}

export function AgentsPage(props: AgentsPageProps) {
  const { showToast } = useStatusToasts();
  const clientRef = useRef(props.client);
  useEffect(() => {
    clientRef.current = props.client;
  }, [props.client]);

  const initialRegistryRef = useRef(
    useAgentRegistryStore.getState().registry,
  );
  const [registryState, setRegistryState] = useState<RegistryState>({
    registry: initialRegistryRef.current,
    updatedAt: null,
    loading: initialRegistryRef.current === null,
    saving: false,
    error: null,
  });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<
    AgentRecord | AgentTemplate | null
  >(null);
  type ScannedSkillEntry = {
    name: string;
    scope: SkillScope;
    path?: string;
    readonly?: boolean;
    description?: string;
    displayNameZh?: string;
    displayNameEn?: string;
    descriptionZh?: string;
    descriptionEn?: string;
  };
  const [scannedSkills, setScannedSkills] = useState<ScannedSkillEntry[]>([]);

  const loadRegistry = useCallback(async () => {
    const workspaceId = props.workspaceId.trim();
    const client = clientRef.current;
    setRegistryState((current) => ({
      ...current,
      loading: current.registry === null,
      error: null,
    }));
    try {
      const userRegistry = isElectronRuntime()
        ? await readUserAgentRegistry()
        : null;
      if (userRegistry) {
        setRegistryState({
          registry: parseUserAgentRegistry(userRegistry.content),
          updatedAt: userRegistry.updatedAt,
          loading: false,
          saving: false,
          error: null,
        });
        return;
      }

      if (workspaceId && client) {
        try {
          let legacyResult: Awaited<ReturnType<NonNullable<typeof client>["readWorkspaceFile"]>>;
          try {
            legacyResult = await client.readWorkspaceFile(
              workspaceId,
              AGENT_REGISTRY_PATH,
            );
          } catch (error) {
            if (!(error instanceof Error && "status" in error && (error as { status?: number }).status === 404)) {
              throw error;
            }
            legacyResult = await client.readWorkspaceFile(
              workspaceId,
              LEGACY_AGENT_REGISTRY_PATH,
            );
          }
          const legacyRegistry = parseAgentRegistry(
            legacyResult.content ?? "",
          );
          const migrated = createAgentRegistryWithUserAgents(
            legacyRegistry.agents,
            legacyRegistry.updatedAt,
          );
          if (isElectronRuntime()) {
            const writeResult = await writeUserAgentRegistry(
              serializeUserAgentRegistry(migrated),
            );
            setRegistryState({
              registry: migrated,
              updatedAt: writeResult.updatedAt,
              loading: false,
              saving: false,
              error: null,
            });
            return;
          }
          setRegistryState({
            registry: migrated,
            updatedAt: readWorkspaceFileUpdatedAt(legacyResult),
            loading: false,
            saving: false,
            error: null,
          });
          return;
        } catch (error) {
          if (
            !(
              error instanceof OnMyAgentServerError &&
              error.status === 404
            )
          ) {
            throw error;
          }
        }
      }

      const seed = createDefaultAgentRegistry();
      const writeResult = isElectronRuntime()
        ? await writeUserAgentRegistry(serializeUserAgentRegistry(seed))
        : null;
      setRegistryState({
        registry: seed,
        updatedAt: writeResult?.updatedAt ?? null,
        loading: false,
        saving: false,
        error: null,
      });
    } catch (error) {
      setRegistryState({
        registry: null,
        updatedAt: null,
        loading: false,
        saving: false,
        error: describeRequestError(error),
      });
    }
  }, [props.workspaceId]);

  useEffect(() => {
    void loadRegistry();
  }, [loadRegistry]);

  const loadSkills = useCallback(async () => {
    const workspaceId = props.workspaceId.trim();
    const client = clientRef.current;
    if (!workspaceId || !client) return;

    try {
      const response = await client.listSkills(workspaceId, {
        includeGlobal: true,
      });
      setScannedSkills(
        response.items.map((entry) => ({
          name: entry.name,
          scope: classifySkillScope(entry, props.workspaceRoot),
          path: entry.path,
          readonly: entry.scope === "built-in",
          description: entry.description,
          displayNameZh: entry.displayNameZh,
          displayNameEn: entry.displayNameEn,
          descriptionZh: entry.descriptionZh,
          descriptionEn: entry.descriptionEn,
        })),
      );
    } catch {
      if (isElectronRuntime()) {
        try {
          const result = await listLocalSkills(props.workspaceRoot);
          const entries = (
            result as Array<{
              name: string;
              path?: string;
              root?: string;
              readonly?: boolean;
              description?: string;
              displayNameZh?: string;
              displayNameEn?: string;
              descriptionZh?: string;
              descriptionEn?: string;
            }>
          ).map((entry) => ({
            name: entry.name,
            scope: classifySkillScope(entry, props.workspaceRoot),
            path: entry.path,
            readonly: entry.readonly === true,
            description: entry.description,
            displayNameZh: entry.displayNameZh,
            displayNameEn: entry.displayNameEn,
            descriptionZh: entry.descriptionZh,
            descriptionEn: entry.descriptionEn,
          }));
          setScannedSkills(entries);
        } catch {
          setScannedSkills([]);
        }
      }
    }
  }, [props.workspaceId, props.workspaceRoot]);

  useEffect(() => {
    if (wizardOpen || editingAgent) {
      void loadSkills();
    }
  }, [wizardOpen, editingAgent, loadSkills]);

  const persistRegistry = useCallback(
    async (nextRegistry: AgentRegistry) => {
      const workspaceId = props.workspaceId.trim();
      const electron = isElectronRuntime();
      const client = props.client;
      if (!electron && (!workspaceId || !client)) return;
      setRegistryState((current) => ({
        ...current,
        saving: true,
        error: null,
      }));
      try {
        const result = electron
          ? await writeUserAgentRegistry(
              serializeUserAgentRegistry(nextRegistry),
            )
          : await (() => {
              if (!client) {
                throw new Error("OnMyAgent server client is unavailable");
              }
              return client.writeWorkspaceFile(workspaceId, {
                path: AGENT_REGISTRY_PATH,
                content: serializeAgentRegistry(nextRegistry),
                baseUpdatedAt: registryState.updatedAt,
              });
            })();
        setRegistryState({
          registry: nextRegistry,
          updatedAt:
            typeof result.updatedAt === "number" ? result.updatedAt : null,
          loading: false,
          saving: false,
          error: null,
        });
      } catch (error) {
        setRegistryState((current) => ({
          ...current,
          saving: false,
          error: describeRequestError(error),
        }));
        throw error;
      }
    },
    [props.client, props.workspaceId, registryState.updatedAt],
  );

  const registry = registryState.registry;

  const mergedSkills = useMemo<AgentSkillItem[]>(() => {
    if (!registry) return [];
    const ANTHROPIC_PREFIX = "anthropic-";
    const scannedByName = new Map(scannedSkills.map((s) => [s.name, s]));
    const hardcodedLocalNames = new Set<string>();

    const registryMapped: AgentSkillItem[] = registry.skills.map((skill) => {
      const localName = skill.id.startsWith(ANTHROPIC_PREFIX)
        ? skill.id.slice(ANTHROPIC_PREFIX.length)
        : skill.id;
      hardcodedLocalNames.add(localName);
      const scanned = scannedByName.get(localName);
      const hasLocalFile = Boolean(scanned);
      return {
        ...skill,
        name: hasLocalFile && scanned ? scanned.name : skill.name,
        description:
          hasLocalFile && scanned
            ? (scanned.description ?? skill.description)
            : skill.description,
        displayNameZh:
          (hasLocalFile && scanned ? scanned.displayNameZh : undefined) ??
          skill.displayNameZh,
        displayNameEn:
          (hasLocalFile && scanned ? scanned.displayNameEn : undefined) ??
          skill.displayNameEn,
        descriptionZh:
          (hasLocalFile && scanned ? scanned.descriptionZh : undefined) ??
          skill.descriptionZh,
        descriptionEn:
          (hasLocalFile && scanned ? scanned.descriptionEn : undefined) ??
          skill.descriptionEn,
        enabled: hasLocalFile,
        category: scanned ? SKILL_SCOPE_LABELS[scanned.scope] : skill.category,
        path: scanned?.path,
        readonly: scanned?.readonly,
      };
    });

    const extraLocal: AgentSkillItem[] = scannedSkills
      .filter((entry) => !hardcodedLocalNames.has(entry.name))
      .map((entry) => ({
        id: entry.name,
        category: SKILL_SCOPE_LABELS[entry.scope],
        group: "",
        name: entry.name,
        description: entry.description ?? entry.name,
        displayNameZh: entry.displayNameZh,
        displayNameEn: entry.displayNameEn,
        descriptionZh: entry.descriptionZh,
        descriptionEn: entry.descriptionEn,
        enabled: true,
        path: entry.path,
        readonly: entry.readonly,
      }));

    return [...extraLocal, ...registryMapped];
  }, [registry, scannedSkills]);

  const runtimeRegistry = useMemo<AgentRegistry | null>(() => {
    if (!registry) return null;
    return {
      ...registry,
      skills: mergedSkills,
    };
  }, [registry, mergedSkills]);

  // Sync the latest runtime registry into the global store so the session
  // domain can restore agent prompts with resolved Skill paths after reloads.
  useEffect(() => {
    if (!runtimeRegistry) return;
    useAgentRegistryStore.getState().setRegistry(runtimeRegistry);
  }, [runtimeRegistry]);

  const visibleCards = useMemo(() => {
    if (!registry) return [];
    const customCards: AgentCardItem[] = registry.agents.map((agent) => ({
      kind: "custom",
      id: agent.id,
      agent,
    }));
    const templateCards: AgentCardItem[] = registry.templates
      .filter(
        (template) =>
          template.id !== "blank-agent" && isAgentTemplateVisible(template),
      )
      .map((template) => ({ kind: "template", id: template.id, template }));
    return [...customCards, ...templateCards];
  }, [registry]);

  const registryRef = useRef(registry);
  registryRef.current = registry;

  useEffect(() => {
    const agentId = props.initialEditingAgentId?.trim();
    if (!agentId) return;
    const r = registryRef.current;
    if (!r) return;
    const agent =
      r.agents.find((item) => item.id === agentId) ?? r.templates.find((item) => item.id === agentId);
    if (!agent) return;
    setWizardOpen(false);
    setEditingAgent(agent);
  }, [props.editRequestKey, props.initialEditingAgentId, registry]);

  useEffect(() => {
    if (!props.initialCreateRequestKey) return;
    setEditingAgent(null);
    setWizardOpen(true);
  }, [props.initialCreateRequestKey]);

  const handleSoon = (label: string) => {
    showToast({
      title: label,
      description: t("agents.coming_soon_desc"),
      tone: "info",
    });
  };

  const handleDeleteAgent = useCallback(
    async (item: AgentCardItem) => {
      if (item.kind !== "custom" || !registry) return;
      const confirmed = window.confirm(
        t("agents.delete_confirm", { name: item.agent.name }),
      );
      if (!confirmed) return;
      const nowIso = new Date().toISOString();
      const nextRegistry: AgentRegistry = {
        ...registry,
        updatedAt: nowIso,
        agents: registry.agents.filter((a) => a.id !== item.id),
      };
      await persistRegistry(nextRegistry);
      showToast({
        title: t("agents.deleted_title", { name: item.agent.name }),
        tone: "success",
        durationMs: 3000,
      });
    },
    [registry, persistRegistry, showToast],
  );

  const handleCreateAgent = async (draft: AgentWizardDraft) => {
    if (!registry) return;
    const nowIso = new Date().toISOString();
    const createdAgent = createAgentRecordFromDraft(draft, nowIso, mergedSkills);
    let agent = createdAgent;
    try {
      const written = await writeMyExpertPackage({
        id: createdAgent.id,
        packageName: createdAgent.id,
        name: createdAgent.name,
        description: createdAgent.description,
        quote: createdAgent.quote,
      });
      agent = {
        ...createdAgent,
        marketplaceSource: "mine",
        marketplacePath: written.path,
        marketplacePackageName: written.packageName,
      };
    } catch (error) {
      console.warn("[expert-marketplace] failed to write my expert package", error);
    }
    const nextRegistry: AgentRegistry = {
      ...registry,
      updatedAt: nowIso,
      agents: [agent, ...registry.agents],
    };
    await persistRegistry(nextRegistry);
    setWizardOpen(false);
    showToast({
      title: t("agents.created_title", { name: agent.name }),
      description: t("agents.config_written_desc", {
        path: USER_AGENT_REGISTRY_DISPLAY_PATH,
      }),
      tone: "success",
      durationMs: 3600,
    });
  };

  const handleUpdateAgent = async (draft: AgentWizardDraft) => {
    if (!registry || !editingAgent) return;
    const nowIso = new Date().toISOString();

    // Check if editing a template or custom agent
    const isTemplate =
      "showInOverview" in editingAgent && "showInWizard" in editingAgent;

    if (isTemplate) {
      // Update template
      const updatedTemplate: AgentTemplate = {
        ...editingAgent,
        name: draft.name,
        description: draft.description,
        quote: draft.quote,
        tone: draft.tone,
        avatarStyle: draft.avatarStyle,
        avatarOptionId: draft.avatarOptionId,
        modelProvider: draft.modelProvider,
        model: draft.model,
        sdkProviderID: draft.sdkProviderID,
        sdkModelID: draft.sdkModelID,
        enabledToolIds: [...draft.enabledToolIds],
        skillIds: [...draft.skillIds],
        preferredName: draft.preferredName,
        preferredLanguage: draft.preferredLanguage,
        userNote: draft.userNote,
        userBackground: draft.userBackground,
        agentMemory: draft.agentMemory,
        userMemory: draft.userMemory,
      } as AgentTemplate;

      const nextRegistry: AgentRegistry = {
        ...registry,
        updatedAt: nowIso,
        templates: registry.templates.map((template) =>
          template.id === editingAgent.id ? updatedTemplate : template,
        ),
      };
      await persistRegistry(nextRegistry);
      setEditingAgent(null);
      showToast({
        title: t("agents.updated_template_title", {
          name: updatedTemplate.name,
        }),
        description: t("agents.config_written_desc", {
          path: USER_AGENT_REGISTRY_DISPLAY_PATH,
        }),
        tone: "success",
        durationMs: 3600,
      });
      return;
    }

    // Update custom agent
    const updatedAgent: AgentRecord = {
      ...(editingAgent as AgentRecord),
      name: draft.name,
      description: draft.description,
      quote: draft.quote,
      tone: draft.tone,
      avatarStyle: draft.avatarStyle,
      avatarOptionId: draft.avatarOptionId,
      customAvatarDataUrl: draft.customAvatarDataUrl,
      modelProvider: draft.modelProvider,
      model: draft.model,
      sdkProviderID: draft.sdkProviderID,
      sdkModelID: draft.sdkModelID,
      enabledToolIds: [...draft.enabledToolIds],
      skillIds: [...draft.skillIds],
      preferredName: draft.preferredName,
      preferredLanguage: draft.preferredLanguage,
      userNote: draft.userNote,
      userBackground: draft.userBackground,
      agentMemory: draft.agentMemory,
      userMemory: draft.userMemory,
      updatedAt: nowIso,
    };
    const nextRegistry: AgentRegistry = {
      ...registry,
      updatedAt: nowIso,
      agents: registry.agents.map((agent) =>
        agent.id === editingAgent.id ? updatedAgent : agent,
      ),
    };
    await persistRegistry(nextRegistry);
    setEditingAgent(null);
    showToast({
      title: t("agents.updated_agent_title", { name: updatedAgent.name }),
      description: t("agents.config_written_desc", {
        path: USER_AGENT_REGISTRY_DISPLAY_PATH,
      }),
      tone: "success",
      durationMs: 3600,
    });
  };

  return (
    <>
      {!props.dialogOnly ? (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-dls-background">
          <div className="flex-1 overflow-auto px-8 py-6">
            <div className={agentsLayoutClass.pageContainer}>
              <div className="space-y-2">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <h1 className={agentsTextClass.pageTitle}>
                    {t("nav.agents")}
                  </h1>
                </div>
                <p className={agentsTextClass.pageDescription}>
                  {t("agents.page_desc")}
                </p>
              </div>

              {registryState.loading ? (
                <div className={agentsLayoutClass.loadingState}>
                  <div className="flex items-center gap-3 text-dls-secondary">
                    <LoadingSpinner size="default" />
                    {t("agents.loading")}
                  </div>
                </div>
              ) : null}

              {!registryState.loading && registryState.error ? (
                <NoticeBox className="mt-8 text-base leading-7" size="comfortable" tone="error">
                  {registryState.error}
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      onClick={() => void loadRegistry()}
                    >
                      {t("common.reload")}
                    </Button>
                  </div>
                </NoticeBox>
              ) : null}

              {!registryState.loading && !registryState.error ? (
                <div className={agentsLayoutClass.cardGrid}>
                  <ActionRowButton
                    density="addCard"
                    type="button"
                    onClick={() => setWizardOpen(true)}
                    className="rounded-xl border-dashed bg-dls-background transition-colors"
                  >
                    <IconTile size="lg" shape="circle" tone="surface" border className="size-14">
                      <Plus className="size-7" />
                    </IconTile>
                    <div className="mt-5 text-sm font-normal text-dls-secondary">
                      {t("agents.new_agent")}
                    </div>
                  </ActionRowButton>
                  {visibleCards.map((item) => (
                    <AgentCard
                      key={item.id}
                      registry={registry}
                      runtimeRegistry={runtimeRegistry}
                      item={item}
                      onAction={handleSoon}
                      onStartConversation={props.onStartConversation}
                      onEdit={(cardItem) => {
                        if (cardItem.kind === "custom") {
                          setEditingAgent(cardItem.agent);
                        } else {
                          setEditingAgent(cardItem.template);
                        }
                      }}
                      onDelete={handleDeleteAgent}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {registry && (wizardOpen || editingAgent) ? (
        <CreateAgentWizard
          key={editingAgent ? `edit-${editingAgent.id}` : "wizard"}
          open
          registry={registry}
          mergedSkills={mergedSkills}
          saving={registryState.saving}
          providers={props.providers}
          connectedProviderIds={props.connectedProviderIds}
          onClose={() => {
            setWizardOpen(false);
            setEditingAgent(null);
          }}
          onCreate={handleCreateAgent}
          onUpdate={handleUpdateAgent}
          onSoon={handleSoon}
          editingAgent={editingAgent ?? undefined}
        />
      ) : null}
    </>
  );
}
