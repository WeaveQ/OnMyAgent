import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Loader2,
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
import { useStatusToasts } from "../shell-feedback/status-toasts";
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
} from "../connections/provider-list-query";
import type { ProviderListItem } from "../../../app/types";
import { useAgentRegistryStore } from "./agent-registry-store";
import {
  classifySkillScope,
  SKILL_SCOPE_LABELS,
  type SkillScope,
} from "../plugins/skill-scope";
import { resolveBundledSkillDisplay } from "../plugins/bundled-skill-locale";
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

const agentsTextClass = {
  cardTitle: "text-base font-medium leading-6 text-dls-text",
  cardDescription: "mt-1.5 line-clamp-3 text-sm leading-6 text-dls-secondary",
  emptyTitle: "mt-5 text-base font-medium leading-6 text-dls-text",
  emptyDescription: "mt-2 text-sm leading-6 text-dls-secondary",
  eyebrow: "flex items-center gap-2 text-sm font-medium text-dls-secondary",
  previewTitle: "mt-3 text-base font-medium leading-6 text-dls-text",
  previewDescription: "mt-5 text-sm leading-6 text-dls-secondary",
  metricLabel: "text-xs text-dls-secondary",
  metricValue: "mt-1.5 text-base font-medium text-dls-text",
  rowTitle: "text-sm font-medium leading-5 text-dls-text",
  rowDescription: "mt-1 text-xs leading-5 text-dls-secondary",
  stepMeta: "mt-0.5 text-xs leading-5 text-dls-secondary",
  fieldLabel: "text-sm font-medium text-dls-text",
  fieldHelp: "text-xs leading-5 text-dls-secondary",
  pageTitle: "text-lg font-medium text-dls-text",
  pageDescription: "text-xs leading-5 text-dls-secondary",
};

const agentsLayoutClass = {
  wizardPanel: "min-h-0 flex-1 space-y-6 overflow-y-auto px-7 py-7",
  fieldStack: "space-y-3",
  compactFieldStack: "space-y-2.5",
  promptTextarea: "min-h-[140px] rounded-xl px-4 py-3 text-sm",
  deleteButton: "absolute right-3 top-3 text-dls-secondary hover:bg-dls-status-danger/10 hover:text-dls-status-danger",
  card: "relative flex min-h-[276px] flex-col rounded-xl border border-dls-border bg-dls-surface p-5",
  cardInteractive: "cursor-pointer transition-colors hover:border-dls-border-strong",
  primaryCardAction: "w-full gap-1.5 bg-dls-decision-soft text-dls-accent hover:bg-dls-accent hover:text-white",
  secondaryCardAction: "w-full gap-1.5 text-xs text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
  emptyHint: "flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-dls-border bg-dls-surface px-6 text-center",
  wizardOverlay: "fixed inset-0 z-[60] bg-black/32 supports-backdrop-filter:backdrop-blur-[10px]",
  wizardDialog: "flex max-h-[78vh] w-[calc(100vw-120px)] max-w-[840px] flex-col gap-0 overflow-hidden rounded-xl p-0 !z-[70] sm:max-w-[840px]",
  editGrid: "min-h-0 flex-1 grid-cols-[160px_1fr] overflow-hidden md:grid",
  editNavButton: "h-auto rounded-none px-4 py-2.5 text-sm data-[active=true]:bg-dls-decision-soft data-[active=true]:text-dls-accent",
  pageContainer: "mx-auto flex w-full max-w-[1520px] flex-col",
  loadingState: "flex min-h-[420px] items-center justify-center",
  cardGrid: "mt-7 grid gap-6 md:grid-cols-2 xl:grid-cols-3",
};

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

function AgentPreviewCard(props: {
  registry: AgentRegistry | null;
  draft: AgentWizardDraft;
}) {
  const previewName = props.draft.name.trim() || t("agents.new_agent");
  const previewQuote =
    props.draft.description.trim() ||
    props.draft.quote.trim() ||
    t("agents.preview_quote_default");
  const hasAvatarSelection = Boolean(
    props.draft.customAvatarDataUrl || props.draft.avatarOptionId,
  );
  return (
    <div className="space-y-3.5">
      <div className={agentsTextClass.eyebrow}>
        <span className="size-2 rounded-full bg-dls-secondary/50" />
        {t("agents.preview")}
      </div>
      <div className="rounded-xl bg-dls-surface-muted p-5">
        <div className="rounded-xl bg-dls-surface px-5 pb-6 pt-9 text-center">
          <div className="-mt-14 flex justify-center">
            {hasAvatarSelection ? (
              renderAvatar(
                props.registry,
                {
                  avatarStyle: props.draft.avatarStyle,
                  avatarOptionId: props.draft.avatarOptionId,
                  customAvatarDataUrl: props.draft.customAvatarDataUrl,
                  name: previewName,
                },
                "size-20 border-4 border-dls-surface text-2xl",
              )
            ) : (
              <div className="flex size-20 items-center justify-center rounded-xl border-4 border-dls-surface bg-dls-hover text-dls-secondary">
                <Sparkles className="size-9" />
              </div>
            )}
          </div>
          <div className={agentsTextClass.previewTitle}>
            {previewName}
          </div>
          <StatusBadge className="mt-2" tone="neutral">
            {t("agents.identity_verified")}
          </StatusBadge>
          <div className={agentsTextClass.previewDescription}>
            "{previewQuote}"
          </div>
          <div className="mt-5 border-t border-dls-border pt-5">
            <div className={agentsTextClass.metricLabel}>
              {t("agents.style")}
            </div>
            <div className={agentsTextClass.metricValue}>
              {agentToneLabel(props.draft.tone)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkillsChooser(props: {
  skills: readonly AgentSkillItem[];
  selectedIds: string[];
  search: string;
  onSearchChange: (value: string) => void;
  onToggleSkill: (id: string) => void;
  onToggleAll: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = (category: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const grouped = useMemo(
    () => buildGroupedSkills({
      skills: props.skills,
      search: props.search,
      scopeOrder: [
        SKILL_SCOPE_LABELS.builtin,
        SKILL_SCOPE_LABELS.onmyagent,
        SKILL_SCOPE_LABELS.local,
      ],
    }),
    [props.skills, props.search],
  );

  const allIds = grouped.flatMap((item) =>
    item.skills.map((skill) => skill.id),
  );
  const allSelected =
    allIds.length > 0 && allIds.every((id) => props.selectedIds.includes(id));

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-dls-secondary">
          <span>{t("agents.skills_picker_desc")}</span>
        </div>
        <InputGroup controlSize="lg">
          <InputGroupAddon align="inline-start">
            <Search className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            value={props.search}
            onChange={(event) =>
              props.onSearchChange(event.currentTarget.value)
            }
            placeholder={t("agents.search_skills")}
            className="text-sm"
          />
        </InputGroup>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={props.onToggleAll}
          className="w-full justify-start gap-3 border-dls-accent/30 bg-dls-decision-soft text-dls-accent"
        >
          <SelectionMark checked className="bg-dls-surface text-dls-accent">
            {allSelected ? "-" : "+"}
          </SelectionMark>
          <span>{t("agents.select_all")}</span>
          <span className="text-dls-accent/70">
            {t("agents.selected_count", { count: props.selectedIds.length })}
          </span>
        </Button>
        <div className="space-y-4">
          {grouped.map((group) => {
            const isCollapsed = collapsed.has(group.category);
            return (
              <div
                key={`${group.category}-${group.group}`}
                className={agentsLayoutClass.fieldStack}
              >
                <NavListButton
                  type="button"
                  size="compact"
                  onClick={() => toggleCollapse(group.category)}
                  className="h-auto w-auto gap-2 px-0 py-0 text-sm hover:bg-transparent"
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-3.5 text-dls-secondary" />
                  ) : (
                    <ChevronDown className="size-3.5 text-dls-secondary" />
                  )}
                  <span>{localizedSkillCategoryLabel(group.category)}</span>
                  <span className="text-xs text-dls-secondary">
                    {t("agents.skills_count", { count: group.skills.length })}
                  </span>
                </NavListButton>
                {!isCollapsed && (
                  <div className={agentsLayoutClass.fieldStack}>
                    {group.skills.map((skill) => {
                      const checked = props.selectedIds.includes(skill.id);
                      const display = resolveBundledSkillDisplay({
                        name: skill.name,
                        description: skill.description,
                        displayNameZh: skill.displayNameZh,
                        displayNameEn: skill.displayNameEn,
                        descriptionZh: skill.descriptionZh,
                        descriptionEn: skill.descriptionEn,
                      });
                      return (
                        <ActionRowButton
                          key={skill.id}
                          type="button"
                          onClick={() => props.onToggleSkill(skill.id)}
                          density="default"
                          className={cn(
                            "flex w-full items-start gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-colors",
                            checked
                              ? "border-dls-accent/30 bg-dls-decision-soft"
                              : "border-dls-border bg-dls-surface",
                          )}
                        >
                          <SelectionMark checked={checked} className="mt-1">
                            ✓
                          </SelectionMark>
                          <div className="min-w-0">
                            <div className={agentsTextClass.rowTitle}>
                              {display.name}
                            </div>
                            <div className={agentsTextClass.rowDescription}>
                              {display.description || display.name}
                            </div>
                          </div>
                        </ActionRowButton>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CreateAgentWizard(props: {
  open: boolean;
  registry: AgentRegistry;
  mergedSkills: AgentSkillItem[];
  saving: boolean;
  providers?: ProviderListItem[];
  connectedProviderIds?: string[];
  onClose: () => void;
  onCreate: (draft: AgentWizardDraft) => Promise<void>;
  onUpdate?: (draft: AgentWizardDraft) => Promise<void>;
  onSoon: (label: string) => void;
  editingAgent?: AgentRecord | AgentTemplate;
}) {
  const [step, setStep] = useState<WizardStep>(0);
  const [draft, setDraft] = useState<AgentWizardDraft>(() =>
    createBlankWizardDraft(props.registry, props.mergedSkills),
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [skillSearch, setSkillSearch] = useState("");
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarPageByStyle, setAvatarPageByStyle] = useState<
    Record<AgentAvatarOption["style"], number>
  >({
    "pixel": 0,
    "adventurer": 0,
    "robot": 0,
    "lorelei": 0,
  });

  const [editSection, setEditSection] = useState<1 | 2 | 3 | 4 | 5>(1);

  useEffect(() => {
    if (!props.open) return;
    if (props.editingAgent) {
      // 编辑模式：直接从步骤 1 开始，用现有智能体数据初始化
      setStep(1);
      // 根据类型选择正确的转换函数
      const isTemplate = "showInOverview" in props.editingAgent;
      setDraft(
        isTemplate
          ? createWizardDraftFromTemplate(
              props.editingAgent as AgentTemplate,
              props.mergedSkills,
            )
          : createWizardDraftFromAgent(
              props.editingAgent as AgentRecord,
              props.mergedSkills,
            ),
      );
      setSelectedItemId(null);
      setNameError(null);
      setSkillSearch("");
      setAvatarPageByStyle({
        "pixel": 0,
        "adventurer": 0,
        "robot": 0,
        "lorelei": 0,
      });
      setEditSection(1);
    } else {
      // 创建模式：从步骤 0 开始，用空白模板初始化
      const blank = createBlankWizardDraft(props.registry, props.mergedSkills);
      setStep(0);
      setDraft(blank);
      setSelectedItemId(null);
      setNameError(null);
      setSkillSearch("");
      setAvatarPageByStyle({
        "pixel": 0,
        "adventurer": 0,
        "robot": 0,
        "lorelei": 0,
      });
    }
  }, [props.open, props.registry, props.editingAgent, props.mergedSkills]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("agent-wizard-open", props.open);
    return () => {
      document.body.classList.remove("agent-wizard-open");
    };
  }, [props.open]);

  const avatarsForStyle = useMemo(
    () =>
      buildVisibleAvatarOptions(
        props.registry,
        draft.avatarStyle,
        avatarPageByStyle[draft.avatarStyle] ?? 0,
      ),
    [avatarPageByStyle, draft.avatarStyle, props.registry],
  );

  // Build dynamic provider list from OpenCode SDK (same source as the
  // session composer model picker). Only shows providers that the user
  // has actually connected (authenticated), matching the behaviour of the
  // model picker in the new-session composer.
  //
  // Each `models` entry carries both the SDK model ID (`id`) and the display
  // name (`name`). `id` is what we store in `draft.sdkModelID` so the chat
  // composer can match the exact SDK ModelRef when jumping to the +新任务 page.
  // For the fallback (no connected providers), we still use friendly names
  // as both id and name, preserving backward compatibility.
  const providerOptions = useMemo(() => {
    type ProviderOption = {
      id: string;
      name: string;
      models: { id: string; name: string }[];
    };
    const auto: ProviderOption = {
      id: "auto",
      name: t("agents.provider_auto"),
      models: [{ id: "auto", name: "Auto" }],
    };
    const all = props.providers ?? [];
    const connectedIds = new Set(props.connectedProviderIds ?? []);

    const connected = all.filter(
      (provider) =>
        connectedIds.has(provider.id) &&
        (provider.source !== "custom" ||
          provider.id === "opencode" ||
          Object.keys(provider.models ?? {}).length > 0),
    );

    if (!connected.length) {
      // Fallback to legacy hard-coded providers for backward compatibility.
      // Use friendly name as both `id` and `name` so the wizard behaves
      // identically to before — `friendlyModelNameToModelRef` will translate
      // the stored friendly name on jump to chat.
      const toOption = (names: readonly string[]) =>
        names.map((name) => ({ id: name, name }));
      const fallbackMap: {
        id: string;
        name: string;
        sourceKey: keyof typeof AGENT_MODEL_OPTIONS;
      }[] = [
        { id: "gemini", name: "Gemini", sourceKey: "Gemini" },
        { id: "openai", name: "OpenAI", sourceKey: "OpenAI" },
        { id: "anthropic", name: "Claude", sourceKey: "Claude" },
      ];
      return [
        auto,
        ...fallbackMap.map((entry) => ({
          id: entry.id,
          name: entry.name,
          models: toOption(AGENT_MODEL_OPTIONS[entry.sourceKey]),
        })),
      ];
    }

    return [
      auto,
      ...connected.map((provider) => ({
        id: provider.id,
        name: provider.name,
        models: Object.entries(provider.models ?? {}).map(([sdkId, model]) => ({
          // `model.id` == sdkId for OpenCode SDK, but guard with explicit sdkId
          id: sdkId,
          name: model.name,
        })),
      })),
    ];
  }, [props.providers, props.connectedProviderIds]);

  const wizardItems = useMemo<AgentCardItem[]>(() => {
    const templates = props.registry.templates.filter(isAgentTemplateWizardVisible);
    const blankItem: AgentCardItem[] = templates
      .filter((t) => t.id === "blank-agent")
      .map((template) => ({ kind: "template", id: template.id, template }));
    const otherTemplateItems: AgentCardItem[] = templates
      .filter((t) => t.id !== "blank-agent")
      .map((template) => ({ kind: "template", id: template.id, template }));
    const customItems: AgentCardItem[] = props.registry.agents.map((agent) => ({
      kind: "custom",
      id: agent.id,
      agent,
    }));
    return [...blankItem, ...customItems, ...otherTemplateItems];
  }, [props.registry.agents, props.registry.templates]);

  const setDraftField = useCallback(
    <K extends keyof AgentWizardDraft>(key: K, value: AgentWizardDraft[K]) => {
      setDraft((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const stepForward = () => {
    if (step === 1) {
      const trimmedName = draft.name.trim();
      if (!trimmedName || trimmedName.length > 24) {
        setNameError(t("agents.name_error"));
        return;
      }
    }
    setNameError(null);
    setStep((current) => nextStep(current));
  };

  const stepBackward = () => {
    setStep((current) => previousStep(current));
  };

  const applyItem = (item: AgentCardItem) => {
    const normalized = normalizeAgentCardItem(item);
    const templateId = item.kind === "template" ? item.id : null;
    const enabledSkillIds = new Set(
      props.mergedSkills
        .filter((skill) => skill.enabled)
        .map((skill) => skill.id),
    );

    setDraft({
      templateId,
      name: normalized.source.name,
      description: normalized.source.description,
      quote: normalized.source.quote,
      tone: normalized.source.tone,
      avatarStyle: normalized.avatarStyle,
      avatarOptionId: normalized.avatarOptionId,
      customAvatarDataUrl: normalized.customAvatarDataUrl,
      modelProvider: normalized.source.modelProvider,
      model: normalized.source.model,
      sdkProviderID: normalized.source.sdkProviderID,
      sdkModelID: normalized.source.sdkModelID,
      enabledToolIds: [...normalized.source.enabledToolIds],
      defaultWorkspace: "",
      skillIds: normalized.source.skillIds.filter((skillId) =>
        enabledSkillIds.has(skillId),
      ),
      preferredName: normalized.source.preferredName,
      preferredLanguage: normalized.source.preferredLanguage,
      userNote: normalized.source.userNote,
      userBackground: normalized.source.userBackground,
      agentMemory: normalized.source.agentMemory ?? "",
      userMemory: normalized.source.userMemory ?? "",
    });

    setSelectedItemId(item.id);
    setNameError(null);
    setAvatarPageByStyle((current) => ({
      ...current,
      [normalized.avatarStyle]: 0,
    }));
  };

  const showMoreAvatars = () => {
    setAvatarPageByStyle((current) => {
      const nextPage = current[draft.avatarStyle] + 1;
      return { ...current, [draft.avatarStyle]: nextPage };
    });
    setDraft((current) => ({
      ...current,
      avatarOptionId: "",
      customAvatarDataUrl: null,
    }));
  };

  const chooseWorkspace = async () => {
    if (!isElectronRuntime()) {
      props.onSoon(t("agents.default_workspace_picker"));
      return;
    }
    const chosen = await pickDirectory();
    if (typeof chosen !== "string" || !chosen.trim()) return;
    setDraftField("defaultWorkspace", chosen.trim());
  };

  const chooseCustomAvatar = async (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onerror = () => reject(new Error(t("agents.error_image_read_failed")));
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error(t("agents.error_image_read_failed")));
      };
      reader.readAsDataURL(file);
    });
    setDraft((current) => ({ ...current, customAvatarDataUrl: dataUrl }));
  };

  const toggleTool = (toolId: (typeof AGENT_TOOL_CATALOG)[number]["id"]) => {
    setDraft((current) => ({
      ...current,
      enabledToolIds: current.enabledToolIds.includes(toolId)
        ? current.enabledToolIds.filter((item) => item !== toolId)
        : [...current.enabledToolIds, toolId],
    }));
  };

  const toggleSkill = (skillId: string) => {
    if (
      !props.mergedSkills.some((skill) => skill.id === skillId && skill.enabled)
    ) {
      return;
    }
    setDraft((current) => ({
      ...current,
      skillIds: current.skillIds.includes(skillId)
        ? current.skillIds.filter((item) => item !== skillId)
        : [...current.skillIds, skillId],
    }));
  };

  const toggleAllSkills = () => {
    const visibleIds = props.mergedSkills
      .filter((skill) => skill.enabled)
      .filter((skill) => {
        const lowered = skillSearch.trim().toLowerCase();
        if (!lowered) return true;
        return `${skill.category} ${skill.group} ${skill.name} ${skill.description}`
          .toLowerCase()
          .includes(lowered);
      })
      .map((skill) => skill.id);
    const allSelected = visibleIds.every((id) => draft.skillIds.includes(id));
    setDraft((current) => ({
      ...current,
      skillIds: allSelected
        ? current.skillIds.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current.skillIds, ...visibleIds])),
    }));
  };

  const submit = async () => {
    if (props.editingAgent && props.onUpdate) {
      await props.onUpdate(draft);
    } else {
      await props.onCreate(draft);
    }
  };

  // ── Edit-mode section renderers ───────────────────────────────
  const renderIdentitySection = () => (
    <div className="min-h-0 flex-1 grid-cols-[1.65fr_0.95fr] overflow-hidden md:grid">
      <div className="space-y-5 overflow-y-auto px-7 py-6">
        <div className={agentsLayoutClass.compactFieldStack}>
          <div className={agentsTextClass.fieldLabel}>
            {t("agents.name")} <span className="text-dls-status-danger">*</span>
          </div>
          <Input
            value={draft.name}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDraftField("name", value);
              if (nameError) {
                const trimmed = value.trim();
                setNameError(
                  trimmed && trimmed.length <= 24
                    ? null
                    : t("agents.name_error"),
                );
              }
            }}
            placeholder={t("agents.name_placeholder")}
            variant="dls"
            controlSize="lg"
            radius="xl"
            density="comfortable"
          />
          {nameError ? (
            <div className="px-1 text-xs text-dls-status-danger">{nameError}</div>
          ) : null}
        </div>
        <div className={agentsLayoutClass.fieldStack}>
          <div className="flex items-center justify-between gap-4">
            <div className={agentsTextClass.fieldLabel}>
              {t("agents.avatar")}
            </div>
            <div>
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void chooseCustomAvatar(
                    event.currentTarget.files?.[0] ?? null,
                  );
                  event.currentTarget.value = "";
                }}
              />
              <Button
                type="button"
                variant="link"
                size="xs"
                className="p-0 text-dls-text"
                onClick={() => uploadInputRef.current?.click()}
              >
                <FolderOpen data-icon="inline-start" className="size-3" />
                {t("agents.upload_custom_image")}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {AGENT_AVATAR_STYLES.map((style) => (
              <PickerChip
                key={style}
                label={agentAvatarStyleLabel(style)}
                active={draft.avatarStyle === style}
                onClick={() =>
                  setDraft((current) => ({ ...current, avatarStyle: style }))
                }
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2.5 rounded-xl border border-dls-border bg-dls-surface p-2.5">
            {avatarsForStyle.map((avatar) => {
              const checked =
                draft.avatarOptionId === avatar.id &&
                !draft.customAvatarDataUrl;
              return (
                <button
                  key={avatar.id}
                  type="button"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      avatarOptionId: avatar.id,
                      customAvatarDataUrl: null,
                    }))
                  }
                  className={cn(
                    "relative rounded-full p-1 transition-transform hover:scale-[1.02]",
                    checked ? "ring-4 ring-dls-accent" : "",
                  )}
                >
                  {renderGeneratedAvatar(
                    avatar,
                    avatar.label || avatar.id,
                    "size-14",
                  )}
                  {checked ? (
                    <BadgeDot className="absolute right-0 top-0" size="sm">
                      ✓
                    </BadgeDot>
                  ) : null}
                </button>
              );
            })}
            <Button
              type="button"
              variant="secondary"
              size="icon-lg"
              onClick={showMoreAvatars}
              className="size-14 rounded-xl border border-dls-border text-sm text-dls-secondary"
            >
              {t("common.more")}
            </Button>
          </div>
        </div>
        <div className={agentsLayoutClass.compactFieldStack}>
          <div className={agentsTextClass.fieldLabel}>
            {t("agents.description")}
          </div>
          <Textarea
            value={draft.description}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDraft((current) => ({
                ...current,
                description: value,
                quote: value,
              }));
            }}
            placeholder={t("agents.description_placeholder")}
            className="min-h-[104px] rounded-xl px-4 py-3 text-sm"
          />
        </div>
        <div className={agentsLayoutClass.fieldStack}>
          <div className={agentsTextClass.fieldLabel}>
            {t("agents.style")}
          </div>
          <div className="flex flex-wrap gap-2.5">
            {AGENT_TONES.map((tone) => (
              <PickerChip
                key={tone}
                label={agentToneLabel(tone)}
                active={draft.tone === tone}
                onClick={() => setDraftField("tone", tone)}
              />
            ))}
          </div>
        </div>
        <div className={agentsLayoutClass.fieldStack}>
          <div className={agentsTextClass.fieldLabel}>
            {t("agents.model_provider")}
          </div>
          <div className="flex flex-wrap gap-2.5">
            {providerOptions.map((provider) => (
              <PickerChip
                key={provider.id}
                label={provider.name}
                active={draft.modelProvider === provider.id}
                onClick={() => {
                  const firstModel = provider.models[0];
                  setDraft((current) => ({
                    ...current,
                    modelProvider: provider.id,
                    model: firstModel?.name ?? current.model,
                    sdkProviderID: provider.id,
                    sdkModelID: firstModel?.id,
                  }));
                }}
              />
            ))}
          </div>
        </div>
        {draft.modelProvider !== "auto" ? (
          <div className={agentsLayoutClass.compactFieldStack}>
            <div className="text-xs font-medium text-dls-text">
              {t("agents.model")}
            </div>
            <SelectMenu
              ariaLabel={t("agents.model")}
              options={
                providerOptions
                  .find((p) => p.id === draft.modelProvider)
                  ?.models.map((model) => ({ value: model.id, label: model.name })) ?? []
              }
                value={draft.sdkModelID ?? draft.model}
                onChange={(value) => {
                  const sdkId = value;
                  const provider = providerOptions.find(
                    (p) => p.id === draft.modelProvider,
                  );
                  const selected = provider?.models.find((m) => m.id === sdkId);
                  setDraft((current) => ({
                    ...current,
                    model: selected?.name ?? current.model,
                    sdkProviderID: provider?.id ?? current.sdkProviderID,
                    sdkModelID: sdkId,
                  }));
                }}
            />
          </div>
        ) : null}
      </div>
      <div className="border-l border-dls-border bg-dls-surface-muted px-5 py-6">
        <AgentPreviewCard registry={props.registry} draft={draft} />
      </div>
    </div>
  );

  const renderToolsSection = () => (
    <div className={agentsLayoutClass.wizardPanel}>
      <div className="grid gap-4 md:grid-cols-2">
        {AGENT_TOOL_CATALOG.map((tool) => (
          <ToolCategoryCard
            key={tool.id}
            id={tool.id}
            name={tool.name}
            description={tool.description}
            enabled={draft.enabledToolIds.includes(tool.id)}
            onToggle={() => toggleTool(tool.id)}
          />
        ))}
      </div>
        <div className={agentsLayoutClass.fieldStack}>
          <div className={agentsTextClass.fieldLabel}>
            {t("agents.default_workspace_optional")}
          </div>
        <div className="flex gap-2.5">
          <Input
            value={draft.defaultWorkspace}
            onChange={(event) =>
              setDraftField("defaultWorkspace", event.currentTarget.value)
            }
            placeholder={t("agents.default_workspace_placeholder")}
            controlSize="xl"
            radius="2xl"
            className="text-sm"
          />
          <Button
            type="button"
            variant="outline"
            className="size-11 rounded-xl"
            onClick={() => void chooseWorkspace()}
          >
            <FolderOpen className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  const renderSkillsSection = () => (
    <div className={agentsLayoutClass.wizardPanel}>
      <SkillsChooser
        skills={props.mergedSkills}
        selectedIds={draft.skillIds}
        search={skillSearch}
        onSearchChange={setSkillSearch}
        onToggleSkill={toggleSkill}
        onToggleAll={toggleAllSkills}
      />
    </div>
  );

  const renderUserSection = () => (
    <div className={agentsLayoutClass.wizardPanel}>
      <div className="grid gap-6 md:grid-cols-2">
        <div className={agentsLayoutClass.fieldStack}>
          <div className={agentsTextClass.fieldLabel}>
            {t("agents.preferred_name")}
          </div>
          <Input
            value={draft.preferredName}
            onChange={(event) =>
              setDraftField("preferredName", event.currentTarget.value)
            }
            placeholder={t("agents.preferred_name_placeholder")}
            controlSize="xl"
            radius="2xl"
            className="text-sm"
          />
        </div>
        <div className={agentsLayoutClass.fieldStack}>
          <div className={agentsTextClass.fieldLabel}>
            {t("agents.preferred_language")}
          </div>
          <Input
            value={draft.preferredLanguage}
            onChange={(event) =>
              setDraftField("preferredLanguage", event.currentTarget.value)
            }
            placeholder={t("agents.preferred_language_placeholder")}
            controlSize="xl"
            radius="2xl"
            className="text-sm"
          />
        </div>
      </div>
      <div className={agentsLayoutClass.fieldStack}>
        <div className={agentsTextClass.fieldLabel}>
          {t("agents.note")}
        </div>
        <Input
          value={draft.userNote}
          onChange={(event) =>
            setDraftField("userNote", event.currentTarget.value)
          }
          placeholder={t("agents.note_placeholder")}
          controlSize="xl"
          radius="2xl"
          className="text-sm"
        />
      </div>
      <div className={agentsLayoutClass.fieldStack}>
        <div className={agentsTextClass.fieldLabel}>
          {t("agents.background")}
        </div>
        <Textarea
          value={draft.userBackground}
          onChange={(event) =>
            setDraftField("userBackground", event.currentTarget.value)
          }
          placeholder={t("agents.background_placeholder")}
          className="min-h-[120px] rounded-xl px-4 py-3 text-sm"
        />
      </div>
    </div>
  );

  const renderMindSection = () => (
    <div className={agentsLayoutClass.wizardPanel}>
      <div className={agentsLayoutClass.fieldStack}>
        <div className="text-sm font-medium text-dls-text">
          {t("agents.agent_memory")}
        </div>
        <p className={agentsTextClass.fieldHelp}>
          {t("agents.agent_memory_desc")}
        </p>
        <Textarea
          value={draft.agentMemory}
          onChange={(event) =>
            setDraftField("agentMemory", event.currentTarget.value)
          }
          placeholder={t("agents.agent_memory_placeholder")}
          className={agentsLayoutClass.promptTextarea}
        />
      </div>
      <div className={agentsLayoutClass.fieldStack}>
        <div className={agentsTextClass.fieldLabel}>
          {t("agents.user_memory")}
        </div>
        <p className={agentsTextClass.fieldHelp}>
          {t("agents.user_memory_desc")}
        </p>
        <Textarea
          value={draft.userMemory}
          onChange={(event) =>
            setDraftField("userMemory", event.currentTarget.value)
          }
          placeholder={t("agents.user_memory_placeholder")}
          className={agentsLayoutClass.promptTextarea}
        />
      </div>
    </div>
  );

  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
    >
      <div
        aria-hidden="true"
        className={agentsLayoutClass.wizardOverlay}
        onMouseDown={props.onClose}
      />
      <DialogContent
        showCloseButton={false}
        overlayClassName="hidden"
        className={agentsLayoutClass.wizardDialog}
      >
        {props.editingAgent ? (
          <div className="border-b border-dls-border px-7 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {renderAvatar(
                  props.registry,
                  {
                    avatarStyle: props.editingAgent.avatarStyle,
                    avatarOptionId: props.editingAgent.avatarOptionId,
                    customAvatarDataUrl:
                      "customAvatarDataUrl" in props.editingAgent
                        ? props.editingAgent.customAvatarDataUrl
                        : null,
                    name: props.editingAgent.name,
                  },
                  "size-10 rounded-xl text-base",
                )}
                <div>
                  <div className={agentsTextClass.cardTitle}>
                    {props.editingAgent.name}
                  </div>
                  <div className="text-xs text-dls-secondary">
                    ID: {props.editingAgent.id}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={props.onClose}
                aria-label={t("common.close")}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="border-b border-dls-border px-7 py-3">
            <div className="flex items-start justify-between gap-5">
              <div className="flex items-center gap-2.5">
                <IconTile shape="xl">
                  <Sparkles className="size-4" />
                </IconTile>
                <div>
                  <div className={agentsTextClass.rowTitle}>
                    {step === 0 ? t("agents.create_agent") : STEP_TITLE[step]}
                  </div>
                  <div className={agentsTextClass.stepMeta}>
                    {step === 0
                      ? t("agents.step_template_progress")
                      : t("agents.step_progress", {
                          step,
                          title: STEP_TITLE[step],
                        })}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-dls-secondary transition-colors hover:text-dls-text"
                onClick={props.onClose}
                aria-label={t("common.close")}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {!props.editingAgent && step === 0 ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-5 pt-7">
              <div>
                <h2 className={agentsTextClass.pageTitle}>
                  {t("agents.choose_start")}
                </h2>
                <p className="mt-2 text-sm leading-6 text-dls-secondary">
                  {t("agents.choose_start_desc")}
                </p>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-4">
                {wizardItems.map((item) => (
                  <TemplateTile
                    key={item.id}
                    registry={props.registry}
                    item={item}
                    active={selectedItemId === item.id}
                    onClick={() => applyItem(item)}
                  />
                ))}
              </div>
            </div>
            <div className="shrink-0 border-t border-dls-border bg-dls-surface px-7 py-4">
              <div className="flex justify-end">
                <Button
                  size="xl"
                  onClick={stepForward}
                >
                  {t("agents.next_identity")}
                  <ChevronRight className="ml-2 size-4" />
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {!props.editingAgent && step === 1 ? renderIdentitySection() : null}

        {!props.editingAgent && step === 2 ? renderToolsSection() : null}

        {!props.editingAgent && step === 3 ? renderSkillsSection() : null}

        {!props.editingAgent && step === 4 ? renderUserSection() : null}

        {!props.editingAgent && step === 5 ? renderMindSection() : null}

        {props.editingAgent ? (
          <>
            <div className={agentsLayoutClass.editGrid}>
              <div className="border-r border-dls-border bg-dls-surface-muted py-4">
                {[
                  { id: 1 as const, label: t("agents.step_identity") },
                  { id: 2 as const, label: t("agents.step_tools") },
                  { id: 3 as const, label: t("agents.step_skills") },
                  { id: 4 as const, label: t("agents.step_user_preferences") },
                  { id: 5 as const, label: t("agents.step_mind") },
                ].map((section) => (
                  <NavListButton
                    key={section.id}
                    type="button"
                    size="compact"
                    onClick={() => setEditSection(section.id)}
                    active={editSection === section.id}
                    className={agentsLayoutClass.editNavButton}
                    data-active={editSection === section.id}
                  >
                    {section.label}
                  </NavListButton>
                ))}
              </div>
              <div className="overflow-y-auto px-7 py-6">
                {editSection === 1 && renderIdentitySection()}
                {editSection === 2 && renderToolsSection()}
                {editSection === 3 && renderSkillsSection()}
                {editSection === 4 && renderUserSection()}
                {editSection === 5 && renderMindSection()}
              </div>
            </div>
            <div className="flex justify-end border-t border-dls-border px-7 py-4">
              <Button
                size="xl"
                onClick={submit}
                disabled={props.saving || !!nameError}
              >
                {props.saving ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </>
        ) : null}

        {step > 0 && !props.editingAgent ? (
          <div className="flex items-center justify-between border-t border-dls-border px-7 py-4">
            <Button
              variant="ghost"
              className="h-10 rounded-xl px-2 text-sm"
              onClick={stepBackward}
            >
              {t("common.back")}
            </Button>
            {step < 5 ? (
              <Button
                size="xl"
                onClick={stepForward}
              >
                {t("agents.next_step", { title: nextStepTitle(step) })}
                <ChevronRight className="ml-2 size-4" />
              </Button>
            ) : (
              <Button
                size="xl"
                onClick={submit}
                disabled={props.saving || !!nameError}
              >
                {props.saving ? t("common.saving") : t("common.create")}
              </Button>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
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
      description: "开发中，敬请期待",
      tone: "info",
    });
  };

  const handleDeleteAgent = useCallback(
    async (item: AgentCardItem) => {
      if (item.kind !== "custom" || !registry) return;
      const confirmed = window.confirm(
        `确定要删除智能体「${item.agent.name}」吗？此操作不可撤销。`,
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
        title: `已删除智能体：${item.agent.name}`,
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
      title: `已创建智能体：${agent.name}`,
      description: `配置已写入 ${USER_AGENT_REGISTRY_DISPLAY_PATH}`,
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
        title: `已更新模板：${updatedTemplate.name}`,
        description: `配置已写入 ${USER_AGENT_REGISTRY_DISPLAY_PATH}`,
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
      title: `已更新智能体：${updatedAgent.name}`,
      description: `配置已写入 ${USER_AGENT_REGISTRY_DISPLAY_PATH}`,
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
