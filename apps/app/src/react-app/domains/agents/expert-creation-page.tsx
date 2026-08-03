/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronsLeft,
  ChevronDown,
  ChevronRight,
  FileText,
  FileSearch,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  FilterChip,
  IconTile,
  NavTabButton,
  SegmentedTabGroup,
} from "@/components/ui/action-row";
import { Textarea } from "@/components/ui/textarea";
import { NoticeBox } from "@/components/ui/notice-box";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SkillMarketplaceCard } from "@/components/ui/skill-marketplace-card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ConfirmModal } from "../../design-system/modals/confirm-modal";
import { t } from "@/i18n";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import type { ModelRef } from "../../../app/types";
import {
  listLocalSkills,
  revealDesktopItemInDir,
  stageMyExpertKnowledge,
} from "../../../app/lib/desktop";
import { isElectronRuntime } from "../../../app/utils";
import type {
  AgentRegistry,
  AgentSkillItem,
  AgentWizardDraft,
} from "./agent-registry";
import {
  createBlankWizardDraft,
  createDefaultAgentRegistry,
} from "./agent-registry";
import { renderAvatar } from "./agents-avatar-rendering";
import { findSkillMarkdownFile, readSkillMarkdown } from "./skill-package-import";
import { SKILL_MARKETPLACE_CATEGORIES } from "@/components/ui/skill-marketplace-categories";
import { ExpertCreationExitDialog } from "./expert-creation-exit-dialog";
import {
  buildExpertPreviewDraftKey,
  hasExpertCreationProgress,
} from "./expert-creation-lifecycle";
import {
  clearExpertCreationStoredState,
  EMPTY_EXPERT_COACH_STATE,
  readExpertCreationStoredState,
  writeExpertCreationStoredState,
} from "./expert-creation-draft-storage";
import {
  ExpertCreationConversation,
  type ExpertCreationComposerProps,
  type ExpertCreationSuggestionApplyOptions,
} from "./expert-creation-conversation";
import {
  buildExpertCreationCoachSystemPrompt,
  buildExpertCreationCoachToolAccess,
  resolveExpertCreationCoachAgent,
} from "./expert-creation-coach-agent";
import {
  mergeExpertDraftSuggestion,
  type ExpertDraftSuggestion,
} from "./expert-creation-suggestions";
import { deleteExpertCreationEphemeralSession } from "./expert-creation-ephemeral-sessions";

export type ExpertCreationTab = "basic" | "memory" | "skills" | "knowledge";

export type ExpertKnowledgeEntry = {
  kind: "file" | "directory";
  relativePath: string;
  file?: File;
  stagedPath?: string;
};

export type ExpertCreationPageProps = {
  showToast?: (input: {
    title: string;
    description: string;
    tone: "success";
    durationMs: number;
  }) => void;
  workspaceId: string;
  workspaceRoot: string;
  opencodeBaseUrl: string | null;
  onmyagentServerToken: string | null;
  client: OnMyAgentServerClient | null;
  registry: AgentRegistry | null;
  skills: AgentSkillItem[];
  selectedModel: ModelRef | null;
  /**
   * Optional host-owned coach panel (SessionSurface embed from session domain).
   * When omitted, falls back to the lightweight ExpertCreationConversation.
   */
  renderCoachPanel?: (input: {
    draft: AgentWizardDraft;
    registry: AgentRegistry;
    initialSessionId: string | null;
    onSessionIdChange: (sessionId: string) => void;
    onApplyDraftSuggestion: (
      suggestion: ExpertDraftSuggestion,
      options: ExpertCreationSuggestionApplyOptions,
    ) => void;
  }) => ReactNode;
  /**
   * Optional host-owned "try draft expert" panel (SessionSurface embed).
   * When omitted, falls back to ExpertCreationConversation preview.
   */
  renderPreviewPanel?: (input: {
    draft: AgentWizardDraft;
    registry: AgentRegistry;
    knowledgePaths: readonly string[];
    sessionKey: string;
    emptyContent: ReactNode;
  }) => ReactNode;
  renderComposer: (props: ExpertCreationComposerProps) => ReactNode;
  onClose: () => void;
  onDone: (
    draft: AgentWizardDraft,
    knowledge: ExpertKnowledgeEntry[],
    availableSkills: AgentSkillItem[],
    draftId: string,
    coachSessionId: string | null,
  ) => Promise<void>;
};

async function encodeKnowledgeFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

const TABS: Array<{ id: ExpertCreationTab; label: string }> = [
  { id: "basic", label: "agents.expert_creation_basic" },
  { id: "memory", label: "agents.expert_creation_memory" },
  { id: "skills", label: "agents.expert_creation_skills" },
  { id: "knowledge", label: "agents.expert_creation_knowledge" },
];

function buildInitialDraft(registry: AgentRegistry | null, skills: AgentSkillItem[]) {
  const source = registry ?? createDefaultAgentRegistry();
  const blank = createBlankWizardDraft(source, skills);
  return {
    ...blank,
    avatarOptionId: blank.avatarOptionId || source.avatars[0]?.id || "",
  };
}

function localSkillLabel(skill: AgentSkillItem): string {
  return skill.displayNameEn?.trim() || skill.name;
}

function localSkillDescription(skill: AgentSkillItem): string {
  return (
    skill.descriptionEn?.trim() ||
    skill.description?.trim() ||
    skill.descriptionZh?.trim() ||
    t("agents.expert_creation_no_skills_desc")
  );
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

function IconCircle(props: { children: ReactNode; className?: string }) {
  return (
    <IconTile size="default" tone="surface" shape="lg" border className={props.className}>
      {props.children}
    </IconTile>
  );
}

function ExpertCreationAvatar(props: {
  registry: AgentRegistry;
  draft: AgentWizardDraft;
  className?: string;
}) {
  if (props.draft.customAvatarDataUrl) {
    return renderAvatar(
      props.registry,
      {
        avatarStyle: props.draft.avatarStyle,
        avatarOptionId: props.draft.avatarOptionId,
        customAvatarDataUrl: props.draft.customAvatarDataUrl,
        name: props.draft.name,
      },
      props.className,
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-dls-surface-muted text-dls-secondary",
        props.className,
      )}
    >
      <UserRound className="size-1/2" strokeWidth={1.7} aria-hidden />
    </span>
  );
}

function ExpertCoach(props: {
  draft: AgentWizardDraft;
  registry: AgentRegistry;
  workspaceRoot: string;
  opencodeBaseUrl: string | null;
  onmyagentServerToken: string | null;
  selectedModel: ModelRef | null;
  renderCoachPanel?: ExpertCreationPageProps["renderCoachPanel"];
  renderComposer: (props: ExpertCreationComposerProps) => ReactNode;
  initialSessionId: string | null;
  onSessionIdChange: (sessionId: string) => void;
  onApplyDraftSuggestion: (
    suggestion: ExpertDraftSuggestion,
    options: ExpertCreationSuggestionApplyOptions,
  ) => void;
}) {
  const coachAgent = resolveExpertCreationCoachAgent(props.registry);
  const coachOptions = [
    t("agents.expert_creation_coach_option_1"),
    t("agents.expert_creation_coach_option_2"),
    t("agents.expert_creation_coach_option_3"),
    t("agents.expert_creation_coach_option_4"),
  ];
  const coachTitle = t("agents.expert_creation_coach");
  const coachSystemPrompt = coachAgent
    ? buildExpertCreationCoachSystemPrompt(coachAgent, props.draft, props.registry.skills)
    : undefined;
  const coachTools = coachAgent
    ? buildExpertCreationCoachToolAccess(coachAgent)
    : undefined;

  // Session domain can inject a full SessionSurface coach panel (no agents→session import).
  if (props.renderCoachPanel) {
    return (
      <>
        {props.renderCoachPanel({
          draft: props.draft,
          registry: props.registry,
          initialSessionId: props.initialSessionId,
          onSessionIdChange: props.onSessionIdChange,
          onApplyDraftSuggestion: props.onApplyDraftSuggestion,
        })}
      </>
    );
  }

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl bg-dls-surface p-5">
      <div className="flex min-h-0 flex-1 flex-col">
        <ExpertCreationConversation
          draft={props.draft}
          workspaceRoot={props.workspaceRoot}
          opencodeBaseUrl={props.opencodeBaseUrl}
          onmyagentServerToken={props.onmyagentServerToken}
          selectedModel={props.selectedModel}
          title={coachTitle}
          avatar={(
            <img
              src={resolvePublicAssetUrl("/expert-creation-coach-avatar.png")}
              alt=""
              className="size-10 shrink-0 rounded-full object-cover"
            />
          )}
          initialContent={(
            <>
              <p>{t("agents.expert_creation_coach_greeting")}</p>
              <p>{t("agents.expert_creation_coach_intro")}</p>
              <p>{t("agents.expert_creation_coach_question")}</p>
              <ol className="list-decimal space-y-1 pl-5">
                {coachOptions.map((option) => (
                  <li key={option}>{option}</li>
                ))}
              </ol>
              <p>{t("agents.expert_creation_coach_reply_hint")}</p>
            </>
          )}
          placeholder={t("agents.expert_creation_coach_placeholder")}
          {...(coachSystemPrompt ? { systemPrompt: coachSystemPrompt } : {})}
          {...(coachTools !== undefined ? { tools: coachTools } : {})}
          emptyMessage={t("agents.expert_creation_coach_failed")}
          renderComposer={props.renderComposer}
          onApplyDraftSuggestion={props.onApplyDraftSuggestion}
        />
        <p className="pt-3 text-center text-xs text-dls-secondary">
          {t("agents.expert_creation_coach_disclaimer")}
        </p>
      </div>
    </aside>
  );
}
function PromptEditor(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-dls-background focus-within:ring-3 focus-within:ring-ring/30">
      <Textarea
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel}
        controlSize="editor"
        className="min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent px-4 py-3 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}

function BasicInfoPanel(props: {
  draft: AgentWizardDraft;
  registry: AgentRegistry;
  compact: boolean;
  onDraftChange: <K extends keyof AgentWizardDraft>(
    key: K,
    value: AgentWizardDraft[K],
  ) => void;
}) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const chooseCustomAvatar = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        props.onDraftChange("customAvatarDataUrl", reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <section className="h-40 shrink-0 rounded-xl bg-dls-surface p-4">
        <div
          className={cn(
            "grid gap-5 xl:grid-cols-[6.5rem_minmax(0,1fr)]",
            !props.compact && "lg:grid-cols-[6.5rem_minmax(0,1fr)]",
          )}
        >
          <div className="flex flex-col items-start gap-3">
            <button
              type="button"
              className="relative rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              onClick={() => uploadInputRef.current?.click()}
              aria-label={t("agents.expert_creation_avatar")}
            >
              <ExpertCreationAvatar registry={props.registry} draft={props.draft} className="size-20 text-xl" />
              <span className="absolute -bottom-1 -right-1 inline-flex size-7 items-center justify-center rounded-full border-2 border-dls-surface bg-dls-text text-dls-surface">
                <Plus className="size-4" aria-hidden />
              </span>
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                chooseCustomAvatar(event.currentTarget.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
          </div>
          <div className="space-y-3">
            <Input
              value={props.draft.name}
              onChange={(event) => props.onDraftChange("name", event.currentTarget.value)}
              placeholder={t("agents.expert_creation_name_placeholder")}
              variant="dls"
              controlSize="lg"
              radius="xl"
              className="border-0 shadow-none"
              aria-label={t("agents.name")}
            />
            <Textarea
              value={props.draft.description}
              onChange={(event) => props.onDraftChange("description", event.currentTarget.value)}
              placeholder={t("agents.expert_creation_intro_placeholder")}
              className="min-h-20 border-0 shadow-none"
              aria-label={t("agents.expert_creation_intro")}
            />
          </div>
        </div>
      </section>
      <section className="flex min-h-0 flex-1 flex-col rounded-xl bg-dls-surface p-4">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-dls-text">
            {t("agents.expert_creation_role_prompt")}
          </h3>
          <p className="mt-1 text-sm leading-6 text-dls-secondary">
            {t("agents.expert_creation_role_prompt_desc")}
          </p>
        </div>
        <PromptEditor
          value={props.draft.userNote}
          onChange={(value) => props.onDraftChange("userNote", value)}
          placeholder={t("agents.expert_creation_role_prompt_placeholder")}
          ariaLabel={t("agents.expert_creation_role_prompt")}
        />
      </section>
    </div>
  );
}

function SkillPickerDialog(props: {
  open: boolean;
  skills: AgentSkillItem[];
  selectedIds: string[];
  onOpenChange: (open: boolean) => void;
  onToggle: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"market" | "installed">("market");
  const [category, setCategory] = useState("all");
  const visibleSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return props.skills.filter((skill) => {
      if (view === "installed" && !skill.path && skill.category !== "installed") return false;
      if (view === "market" && category !== "all" && skill.category !== category) return false;
      if (!normalized) return true;
      return `${skill.name} ${skill.description} ${skill.category}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [category, props.skills, query, view]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex h-[min(48rem,calc(100vh-3rem))] w-[calc(100vw-4rem)] max-w-none flex-col gap-0 overflow-hidden rounded-xl bg-dls-background p-0 text-dls-text sm:w-[calc(100vw-4rem)] sm:max-w-none">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-dls-border px-6 py-4">
          <DialogHeader>
            <DialogTitle>{t("agents.expert_creation_skill_picker_title")}</DialogTitle>
            <DialogDescription>{t("agents.expert_creation_skill_picker_desc")}</DialogDescription>
          </DialogHeader>
          <SegmentedTabGroup aria-label={t("agents.expert_creation_skill_picker_title")}>
            <NavTabButton size="tab" shape="tab" active={view === "market"} onClick={() => setView("market")}>
              {t("store.skills_marketplace")}
            </NavTabButton>
            <NavTabButton size="tab" shape="tab" active={view === "installed"} onClick={() => setView("installed")}>
              {t("store.my_skills")}
            </NavTabButton>
          </SegmentedTabGroup>
          <span className="pr-8" aria-hidden />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {view === "market" ? (
            <div className="flex shrink-0 flex-wrap items-center gap-x-0.5 gap-y-1.5 px-6 py-2.5">
              {SKILL_MARKETPLACE_CATEGORIES.map((item) => (
                <FilterChip
                  key={item.id}
                  label={t(item.labelKey)}
                  selected={category === item.id}
                  onClick={() => setCategory(item.id)}
                />
              ))}
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t("agents.search_skills")}
              aria-label={t("agents.search_skills")}
              variant="dls"
              controlSize="lg"
              radius="xl"
            />
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 items-start gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visibleSkills.map((skill) => {
              const selected = props.selectedIds.includes(skill.id);
              return (
                <SkillMarketplaceCard
                  key={skill.id}
                  skill={{
                    id: skill.id,
                    displayName: localSkillLabel(skill),
                    packageName: skill.name,
                    description: localSkillDescription(skill),
                    chips: skill.category && skill.category !== "installed"
                      ? [skill.category]
                      : [],
                  }}
                  selected={selected}
                  ariaLabel={localSkillLabel(skill)}
                  onClick={() => props.onToggle(skill.id)}
                  action={selected ? (
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-dls-accent text-white">
                      <Check className="size-3.5" aria-hidden />
                    </span>
                  ) : (
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-dls-surface-muted text-dls-secondary">
                      <Plus className="size-4" aria-hidden />
                    </span>
                  )}
                />
              );
            })}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SkillImportDialog(props: {
  open: boolean;
  importing: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const importFiles = (files: File[]) => {
    if (files.length === 0) return;
    props.onImport(files);
    props.onOpenChange(false);
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xl gap-4 rounded-xl bg-dls-surface p-6 text-dls-text sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("skills_marketplace.import_title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("skills_marketplace.import_drop")}</DialogDescription>
        </DialogHeader>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".md,.zip"
          multiple
          onChange={(event) => {
            importFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          disabled={props.importing}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            importFiles(Array.from(event.dataTransfer.files));
          }}
          className={cn(
            "flex min-h-32 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-dls-border bg-dls-background text-center transition-colors mac:titlebar-no-drag",
            dragActive ? "border-dls-accent bg-dls-hover" : "hover:border-dls-border hover:bg-dls-hover",
            props.importing && "cursor-wait opacity-70",
          )}
        >
          <span className="flex size-8 items-center justify-center rounded-md bg-dls-surface text-dls-secondary">
            {props.importing ? <LoadingSpinner size="default" /> : <Upload className="size-4" />}
          </span>
          <span className="text-sm text-dls-text">{t("skills_marketplace.import_drop")}</span>
        </button>
        <div className="space-y-2 text-xs leading-5 text-dls-secondary">
          <div className="font-medium text-dls-text">{t("skills_marketplace.import_requirements_title")}</div>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("skills_marketplace.import_requirement_skill_md")}</li>
            <li>{t("skills_marketplace.import_requirement_frontmatter")}</li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SkillsPanel(props: {
  skills: AgentSkillItem[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  onImport: (files: File[]) => void;
  importing: boolean;
  loading: boolean;
  loadError: boolean;
  onRetryLoad: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const selectedSkills = props.skills.filter((skill) => props.selectedIds.includes(skill.id));

  const toggleSkill = (id: string) => {
    props.onSelectedIdsChange(
      props.selectedIds.includes(id)
        ? props.selectedIds.filter((item) => item !== id)
        : [...props.selectedIds, id],
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="mt-1 text-sm text-dls-secondary">{t("agents.expert_creation_skills_desc")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedSkills.length > 0 ? (
            <Button type="button" size="sm" variant="ghost" disabled={props.importing} onClick={() => setImportOpen(true)}>
              <Upload data-icon="inline-start" className="size-3.5" />
              {props.importing ? t("agents.expert_creation_importing") : t("agents.expert_creation_import_skill")}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" disabled={props.loading || props.loadError} onClick={() => setPickerOpen(true)}>
            <Plus data-icon="inline-start" className="size-3.5" />
            {t("agents.expert_creation_add_skill")}
          </Button>
        </div>
      </div>
      {props.loading && selectedSkills.length === 0 ? (
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center rounded-xl bg-dls-surface px-6 text-center">
          <LoadingSpinner size="default" />
          <p className="mt-4 text-sm text-dls-secondary">{t("agents.expert_creation_loading_skills")}</p>
        </div>
      ) : props.loadError && selectedSkills.length === 0 ? (
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center rounded-xl bg-dls-surface px-6 text-center">
          <NoticeBox role="alert" tone="error" size="content" className="max-w-md">
            {t("agents.expert_creation_load_skills_failed")}
          </NoticeBox>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={props.onRetryLoad}>
              {t("agents.expert_creation_retry")}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={props.importing} onClick={() => setImportOpen(true)}>
              <Upload data-icon="inline-start" className="size-3.5" />
              {props.importing ? t("agents.expert_creation_importing") : t("agents.expert_creation_import_skill")}
            </Button>
          </div>
        </div>
      ) : selectedSkills.length > 0 ? (
        <div className="grid grid-cols-1 items-start gap-2.5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {selectedSkills.map((skill) => {
            return (
              <SkillMarketplaceCard
                key={skill.id}
                skill={{
                  id: skill.id,
                  displayName: localSkillLabel(skill),
                  packageName: skill.name,
                  description: localSkillDescription(skill),
                  chips: skill.category && skill.category !== "installed"
                    ? [skill.category]
                    : [],
                }}
                ariaLabel={localSkillLabel(skill)}
                action={(
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => toggleSkill(skill.id)}
                    aria-label={t("agents.expert_creation_remove_skill")}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                )}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center rounded-xl bg-dls-surface px-6 text-center">
          <FileSearch className="size-20 text-dls-secondary" strokeWidth={1.2} aria-hidden />
          <h3 className="mt-5 text-sm font-semibold text-dls-text">{t("agents.expert_creation_no_skills")}</h3>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
              <Plus data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_add_skill")}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={props.importing} onClick={() => setImportOpen(true)}>
              <Upload data-icon="inline-start" className="size-3.5" />
              {props.importing ? t("agents.expert_creation_importing") : t("agents.expert_creation_import_skill")}
            </Button>
          </div>
        </div>
      )}
      <SkillPickerDialog
        open={pickerOpen}
        skills={props.skills}
        selectedIds={props.selectedIds}
        onOpenChange={setPickerOpen}
        onToggle={toggleSkill}
      />
      <SkillImportDialog
        open={importOpen}
        importing={props.importing}
        onOpenChange={setImportOpen}
        onImport={props.onImport}
      />
    </div>
  );
}

export type ExpertKnowledgeNode = ExpertKnowledgeEntry & { name: string };

export function joinKnowledgePath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

export function listKnowledgeChildren(
  entries: ExpertKnowledgeEntry[],
  currentPath: string,
): ExpertKnowledgeNode[] {
  const prefix = currentPath ? `${currentPath}/` : "";
  const nodes = new Map<string, ExpertKnowledgeNode>();
  for (const entry of entries) {
    if (!entry.relativePath.startsWith(prefix)) continue;
    const remainder = entry.relativePath.slice(prefix.length);
    if (!remainder) continue;
    const [name, ...rest] = remainder.split("/");
    const relativePath = joinKnowledgePath(currentPath, name);
    const kind = rest.length > 0 ? "directory" : entry.kind;
    const previous = nodes.get(relativePath);
    if (!previous || kind === "directory") {
      nodes.set(relativePath, {
        kind,
        relativePath,
        name,
        ...(kind === "file" && entry.file ? { file: entry.file } : {}),
        ...(entry.stagedPath ? { stagedPath: entry.stagedPath } : {}),
      });
    }
  }
  return Array.from(nodes.values()).sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export function removeKnowledgeNode(
  entries: ExpertKnowledgeEntry[],
  nodePath: string,
): ExpertKnowledgeEntry[] {
  return entries.filter((entry) => (
    entry.relativePath !== nodePath &&
    !entry.relativePath.startsWith(`${nodePath}/`)
  ));
}

function sourcePathForKnowledgeEntry(
  entries: ExpertKnowledgeEntry[],
  node: ExpertKnowledgeNode,
): string | null {
  const source = node.file ?? entries.find(
    (entry) => entry.file && (
      entry.relativePath === node.relativePath ||
      entry.relativePath.startsWith(`${node.relativePath}/`)
    ),
  )?.file;
  const stagedPath = node.stagedPath ?? entries.find(
    (entry) => entry.stagedPath && (
      entry.relativePath === node.relativePath ||
      entry.relativePath.startsWith(`${node.relativePath}/`)
    ),
  )?.stagedPath;
  return stagedPath ?? (
    source
      ? window.__ONMYAGENT_ELECTRON__?.files?.getPathForFile?.(source) ?? null
      : null
  );
}

function KnowledgePanel(props: {
  entries: ExpertKnowledgeEntry[];
  staging: boolean;
  onEntriesChange: (entries: ExpertKnowledgeEntry[]) => Promise<void>;
}) {
  const documentInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [folderDialogError, setFolderDialogError] = useState<"invalid" | "duplicate" | null>(null);
  const [knowledgeError, setKnowledgeError] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ExpertKnowledgeNode | null>(null);
  const children = useMemo(
    () => listKnowledgeChildren(props.entries, currentPath),
    [currentPath, props.entries],
  );
  const breadcrumbs = currentPath ? currentPath.split("/") : [];

  const addFiles = (files: File[]) => {
    const validFiles = files.filter((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const directorySegments = relativePath.split("/").slice(0, -1);
      return directorySegments.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment));
    });
    setKnowledgeError(validFiles.length !== files.length);
    if (validFiles.length === 0) return;
    const next = new Map(props.entries.map((entry) => [entry.relativePath, entry]));
    for (const file of validFiles) {
      const relativePath = joinKnowledgePath(
        currentPath,
        file.webkitRelativePath || file.name,
      );
      next.set(relativePath, { kind: "file", relativePath, file });
    }
    void props.onEntriesChange(Array.from(next.values()));
  };

  const createFolder = () => {
    const name = folderName.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(name.trim())) {
      setFolderDialogError("invalid");
      return;
    }
    const relativePath = joinKnowledgePath(currentPath, name);
    if (props.entries.some((entry) => entry.relativePath === relativePath)) {
      setFolderDialogError("duplicate");
      return;
    }
    setFolderDialogError(null);
    setFolderDialogOpen(false);
    setFolderName("");
    void props.onEntriesChange([
      ...props.entries,
      { kind: "directory", relativePath },
    ]);
  };

  const deleteNode = (node: ExpertKnowledgeNode) => {
    void props.onEntriesChange(removeKnowledgeNode(props.entries, node.relativePath));
    setPendingDelete(null);
  };

  const openFolderUpload = () => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.click();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="mt-1 text-sm text-dls-secondary">{t("agents.expert_creation_knowledge_desc")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={props.staging} onClick={() => {
            setFolderDialogError(null);
            setFolderName("");
            setFolderDialogOpen(true);
          }}>
            <FolderPlus data-icon="inline-start" className="size-3.5" />
            {t("agents.expert_creation_create_folder")}
          </Button>
          <input
            ref={documentInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              addFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              addFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <Button type="button" size="sm" variant="outline" disabled={props.staging}>
                  <Upload data-icon="inline-start" className="size-3.5" />
                  {t("agents.expert_creation_upload")}
                  <ChevronDown className="size-3.5" aria-hidden />
                </Button>
              }
            />
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              className="min-w-40 border border-dls-border bg-dls-surface-solid p-1.5 text-dls-text"
            >
              <DropdownMenuItem
                onClick={() => documentInputRef.current?.click()}
                className="cursor-pointer gap-2 text-dls-text focus:bg-dls-hover"
              >
                <Upload className="size-4 text-dls-secondary" aria-hidden />
                {t("agents.expert_creation_upload_document")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={openFolderUpload}
                className="cursor-pointer gap-2 text-dls-text focus:bg-dls-hover"
              >
                <FolderPlus className="size-4 text-dls-secondary" aria-hidden />
                {t("agents.expert_creation_upload_folder")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {knowledgeError ? (
        <NoticeBox role="alert" tone="error" size="content">
          {t("agents.expert_creation_knowledge_path_error")}
        </NoticeBox>
      ) : null}
      {props.entries.length > 0 || currentPath ? (
        <div className="space-y-2">
          <nav className="flex min-w-0 items-center gap-1 text-sm text-dls-secondary" aria-label={t("files.breadcrumb_label")}>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCurrentPath("")}>
              {t("agents.expert_creation_knowledge")}
            </Button>
            {breadcrumbs.map((segment, index) => {
              const path = breadcrumbs.slice(0, index + 1).join("/");
              return (
                <span key={path} className="flex min-w-0 items-center gap-1">
                  <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                  <Button type="button" size="sm" variant="ghost" className="min-w-0" onClick={() => setCurrentPath(path)}>
                    <span className="truncate">{segment}</span>
                  </Button>
                </span>
              );
            })}
          </nav>
          {children.length > 0 ? children.map((node) => {
            const sourcePath = sourcePathForKnowledgeEntry(props.entries, node);
            return (
              <div key={node.relativePath} className="flex items-center gap-3 rounded-lg bg-dls-surface px-3 py-2.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => {
                    if (node.kind === "directory") setCurrentPath(node.relativePath);
                  }}
                >
                  <IconCircle className="size-8">
                    {node.kind === "directory" ? <Folder className="size-4" /> : <FileText className="size-4" />}
                  </IconCircle>
                  <span className="min-w-0 flex-1 truncate text-sm text-dls-text">{node.name}</span>
                  {node.kind === "directory" ? <ChevronRight className="size-4 text-dls-secondary" aria-hidden /> : null}
                </button>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger render={
                    <Button type="button" size="icon-xs" variant="ghost" aria-label={t("files.column_actions")}>
                      <MoreHorizontal className="size-4" aria-hidden />
                    </Button>
                  } />
                  <DropdownMenuContent align="end" sideOffset={6} className="min-w-40 border border-dls-border bg-dls-surface-solid p-1.5 text-dls-text">
                    <DropdownMenuItem
                      disabled={!sourcePath}
                      onClick={() => {
                        if (sourcePath) void revealDesktopItemInDir(sourcePath);
                      }}
                      className="cursor-pointer gap-2 text-dls-text focus:bg-dls-hover"
                    >
                      <Folder className="size-4 text-dls-secondary" aria-hidden />
                      {t("files.open_in_folder")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setPendingDelete(node)}
                      className="cursor-pointer gap-2 text-dls-status-danger-fg focus:bg-dls-hover"
                    >
                      <X className="size-4" aria-hidden />
                      {t("common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          }) : (
            <div className="flex min-h-48 items-center justify-center rounded-xl bg-dls-surface text-sm text-dls-secondary">
              {t("agents.expert_creation_knowledge_empty")}
            </div>
          )}
          <p className="pt-2 text-xs text-dls-secondary">
            {t("agents.expert_creation_knowledge_files", { count: props.entries.length })}
          </p>
        </div>
      ) : (
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center rounded-xl bg-dls-surface px-6 text-center">
          <div className="flex items-end -space-x-2">
            <IconCircle className="size-10 rotate-[-8deg] bg-dls-background text-dls-accent">
              <Upload className="size-5" aria-hidden />
            </IconCircle>
            <IconCircle className="relative z-10 size-12 bg-dls-background text-dls-accent">
              <Sparkles className="size-6" aria-hidden />
            </IconCircle>
            <IconCircle className="size-10 rotate-[8deg] bg-dls-background text-dls-accent">
              <FolderPlus className="size-5" aria-hidden />
            </IconCircle>
          </div>
          <p className="mt-6 max-w-sm text-sm leading-6 text-dls-secondary">{t("agents.expert_creation_knowledge_empty_desc")}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={props.staging} onClick={() => {
              setFolderDialogError(null);
              setFolderName("");
              setFolderDialogOpen(true);
            }}>
              <FolderPlus data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_create_folder")}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={props.staging} onClick={() => documentInputRef.current?.click()}>
              <Upload data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_upload_document")}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={props.staging} onClick={openFolderUpload}>
              <FolderPlus data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_upload_folder")}
            </Button>
          </div>
        </div>
      )}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="w-[min(28rem,calc(100%-2rem))] gap-4 rounded-xl bg-dls-surface p-5 text-dls-text">
          <DialogHeader>
            <DialogTitle>{t("agents.expert_creation_create_folder")}</DialogTitle>
            <DialogDescription>{t("agents.expert_creation_folder_name")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              value={folderName}
              onChange={(event) => {
                setFolderName(event.currentTarget.value);
                setFolderDialogError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  createFolder();
                }
              }}
              placeholder={t("agents.expert_creation_folder_name_placeholder")}
              aria-label={t("agents.expert_creation_folder_name")}
            />
            {folderDialogError ? (
              <p className="text-sm text-dls-status-danger-fg">
                {t(folderDialogError === "duplicate"
                  ? "agents.expert_creation_folder_name_duplicate"
                  : "agents.expert_creation_folder_name_error")}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFolderDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={createFolder}>
              {t("common.create")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmModal
        open={pendingDelete !== null}
        title={t("files.delete_confirm_title")}
        message={t("files.delete_confirm_desc", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => {
          if (pendingDelete) deleteNode(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function TryEffectPanel(props: {
  draft: AgentWizardDraft;
  knowledge: ExpertKnowledgeEntry[];
  registry: AgentRegistry;
  workspaceRoot: string;
  opencodeBaseUrl: string | null;
  onmyagentServerToken: string | null;
  selectedModel: ModelRef | null;
  renderPreviewPanel?: ExpertCreationPageProps["renderPreviewPanel"];
  renderComposer: (props: ExpertCreationComposerProps) => ReactNode;
  onClose: () => void;
}) {
  const [sessionVersion, setSessionVersion] = useState(0);
  const draftKey = buildExpertPreviewDraftKey(props.draft);
  const sessionKey = `${draftKey}:${sessionVersion}`;
  const knowledgePaths = props.knowledge
    .filter((entry) => entry.kind === "file" && entry.stagedPath)
    .map((entry) => entry.stagedPath ?? "");
  const emptyContent = (
    <div className="flex min-h-64 flex-col items-center justify-center text-center text-sm leading-6 text-dls-secondary">
      <ExpertCreationAvatar registry={props.registry} draft={props.draft} className="size-20" />
      <span className="mt-4 max-w-44">
        {props.draft.name.trim()
          ? t("agents.expert_creation_preview_ready")
          : t("agents.expert_creation_preview_empty")}
      </span>
    </div>
  );

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl bg-dls-surface">
      <div className="flex items-center gap-2 border-b border-dls-border px-5 py-4">
        <Button type="button" variant="ghost" size="icon-sm" onClick={props.onClose} aria-label={t("agents.expert_creation_preview_close")}>
          <ChevronsLeft className="size-5" aria-hidden />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-dls-text">
          {t("agents.expert_creation_preview_title")}
        </h2>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => setSessionVersion((current) => current + 1)} aria-label={t("agents.expert_creation_preview_new_session")}>
          <Plus className="size-5" aria-hidden />
        </Button>
      </div>
      {props.renderPreviewPanel ? (
        <div className="min-h-0 flex-1 overflow-hidden p-2">
          {props.renderPreviewPanel({
            draft: props.draft,
            registry: props.registry,
            knowledgePaths,
            sessionKey,
            emptyContent,
          })}
        </div>
      ) : (
        <ExpertCreationConversation
          key={sessionKey}
          draft={props.draft}
          workspaceRoot={props.workspaceRoot}
          opencodeBaseUrl={props.opencodeBaseUrl}
          onmyagentServerToken={props.onmyagentServerToken}
          selectedModel={props.selectedModel}
          knowledgePaths={knowledgePaths}
          title={props.draft.name || t("agents.expert_creation_preview_title")}
          avatar={null}
          emptyContent={emptyContent}
          placeholder={t("agents.expert_creation_preview_placeholder")}
          emptyMessage={t("agents.expert_creation_preview_failed")}
          disabled={!props.draft.name.trim()}
          hideHeader
          className="p-4"
          renderComposer={props.renderComposer}
        />
      )}
    </aside>
  );
}

export function ExpertCreationPage(props: ExpertCreationPageProps) {
  const sourceRegistry = props.registry ?? createDefaultAgentRegistry();
  const [baselineDraft] = useState(() => buildInitialDraft(props.registry, props.skills));
  const [activeTab, setActiveTab] = useState<ExpertCreationTab>("basic");
  const [storedInitialState] = useState(() => readExpertCreationStoredState(
    props.workspaceId,
    buildInitialDraft(props.registry, props.skills),
  ));
  const [draft, setDraft] = useState(storedInitialState.draft);
  const [initialRetainedCoachSessionId] = useState(
    storedInitialState.coach.sessionId,
  );
  const [coachSessionId, setCoachSessionId] = useState(
    storedInitialState.coach.sessionId,
  );
  const [availableSkills, setAvailableSkills] = useState(() =>
    props.skills.filter((skill) => skill.enabled),
  );
  const [knowledge, setKnowledge] = useState<ExpertKnowledgeEntry[]>([]);
  const [draftPackageId] = useState(() => `draft-${crypto.randomUUID()}`);
  const [knowledgeStaging, setKnowledgeStaging] = useState(false);
  const [tryOpen, setTryOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsLoadError, setSkillsLoadError] = useState(false);
  const [skillsReloadToken, setSkillsReloadToken] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    writeExpertCreationStoredState(props.workspaceId, {
      draft,
      coach: {
        ...EMPTY_EXPERT_COACH_STATE,
        sessionId: initialRetainedCoachSessionId,
      },
    });
  }, [draft, initialRetainedCoachSessionId, props.workspaceId]);

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
      await props.onDone(
        draft,
        knowledge,
        availableSkills,
        draftPackageId,
        coachSessionId,
      );
      clearExpertCreationStoredState(props.workspaceId);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("agents.expert_creation_create_failed"));
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
    clearExpertCreationStoredState(props.workspaceId);
    if (isElectronRuntime()) {
      void stageMyExpertKnowledge({ draftId: draftPackageId, discard: true });
    }
    if (coachSessionId && props.client) {
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
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-dls-border bg-dls-surface px-5">
        <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={requestClose}>
          <ArrowLeft data-icon="inline-start" className="size-4" />
          {t("agents.expert_creation_back")}
        </Button>
        <h1 className="text-sm font-semibold text-dls-text">{t("common.create")}</h1>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="disabled:bg-dls-surface-muted disabled:text-dls-secondary"
            aria-busy={submitting}
            disabled={!draft.name.trim() || submitting}
            onClick={() => void submit()}
          >
            {submitting ? t("agents.expert_creation_saving") : t("agents.expert_creation_done")}
          </Button>
        </div>
      </header>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 bg-dls-background p-3">
        <ResizablePanel defaultSize="34%" minSize="300px" maxSize="48%" className="min-w-0">
          <ExpertCoach
            draft={draft}
            registry={sourceRegistry}
            workspaceRoot={props.workspaceRoot}
            opencodeBaseUrl={props.opencodeBaseUrl}
            onmyagentServerToken={props.onmyagentServerToken}
            selectedModel={props.selectedModel}
            renderCoachPanel={props.renderCoachPanel}
            renderComposer={props.renderComposer}
            initialSessionId={coachSessionId}
            onSessionIdChange={setCoachSessionId}
            onApplyDraftSuggestion={(suggestion, options) => {
              let appliedCount = 0;
              const memoryWasConfirmed = options.mode === "force" && Boolean(suggestion.agentMemory?.trim());
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
              setActiveTab(memoryWasConfirmed ? "memory" : "basic");
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
        <ResizableHandle withHandle aria-label={t("agents.expert_creation_resize_coach")} />
        <ResizablePanel minSize="420px" className="min-w-0">
        <main className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-dls-surface">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-dls-border bg-dls-surface px-4 py-3">
            <span aria-hidden />
            <SegmentedTabGroup aria-label={t("agents.expert_creation_title")}>
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
              <Button type="button" variant="ghost" size="sm" className="justify-self-end" onClick={() => setTryOpen(true)}>
                <ChevronsLeft data-icon="inline-start" className="size-4" />
                {t("agents.expert_creation_try")}
              </Button>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1">
            <section className="min-w-0 flex-1 overflow-y-auto p-4">
              <div className="h-full min-h-0 w-full">
                {submitError ? (
                  <NoticeBox role="alert" tone="error" size="content" className="mb-4">
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
                  <section className="flex h-full min-h-0 flex-col rounded-xl bg-dls-surface p-4">
                    <div className="mb-4">
                      <h3 className="text-base font-semibold text-dls-text">
                        {t("agents.expert_creation_memory")}
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-dls-secondary">
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
                    selectedIds={selectedIds}
                    onSelectedIdsChange={(ids) => setDraftField("skillIds", ids)}
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
            <ResizableHandle withHandle aria-label={t("agents.expert_creation_resize_preview")} />
            <ResizablePanel defaultSize="25%" minSize="280px" maxSize="42%" className="min-w-0">
              <TryEffectPanel
                draft={draft}
                knowledge={knowledge}
                registry={sourceRegistry}
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
