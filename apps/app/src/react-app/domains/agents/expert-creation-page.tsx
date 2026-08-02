/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronsLeft,
  ChevronDown,
  Clock3,
  FileSearch,
  FolderPlus,
  Mic,
  Plus,
  Send,
  Sparkles,
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
  NavTabButton,
  SegmentedTabGroup,
} from "@/components/ui/action-row";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NoticeBox } from "@/components/ui/notice-box";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { listLocalSkills } from "../../../app/lib/desktop";
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
import { SkillGlyphIcon } from "../../design-system/skill-glyph-icon";
import {
  applyExpertCoachProposal,
  type ExpertCoachProposal,
} from "./expert-creation-coach-model";
import { runExpertCoachTurn } from "./expert-creation-coach-runtime";
import { runExpertPreviewTurn } from "./expert-creation-preview-runtime";
import { mergeExpertChatAttachments } from "./expert-creation-chat-attachments";
import { ExpertCreationExitDialog } from "./expert-creation-exit-dialog";
import {
  buildExpertPreviewDraftKey,
  hasExpertCreationProgress,
} from "./expert-creation-lifecycle";
import {
  clearExpertCreationStoredState,
  readExpertCreationStoredState,
  writeExpertCreationStoredState,
  type ExpertCoachMessage,
  type ExpertCoachState,
  type ExpertCoachVersion,
} from "./expert-creation-draft-storage";

export type ExpertCreationTab = "basic" | "memory" | "skills" | "knowledge";

export type ExpertKnowledgeEntry = {
  kind: "file" | "directory";
  relativePath: string;
  file?: File;
};

export type ExpertCreationPageProps = {
  workspaceId: string;
  workspaceRoot: string;
  opencodeBaseUrl: string | null;
  onmyagentServerToken: string | null;
  client: OnMyAgentServerClient | null;
  registry: AgentRegistry | null;
  skills: AgentSkillItem[];
  onClose: () => void;
  onDone: (
    draft: AgentWizardDraft,
    knowledge: ExpertKnowledgeEntry[],
    availableSkills: AgentSkillItem[],
  ) => Promise<void>;
};

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
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-dls-border bg-dls-surface-muted text-dls-secondary",
        props.className,
      )}
    >
      {props.children}
    </span>
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
  registry: AgentRegistry;
  draft: AgentWizardDraft;
  skills: AgentSkillItem[];
  workspaceRoot: string;
  opencodeBaseUrl: string | null;
  onmyagentServerToken: string | null;
  state: ExpertCoachState;
  onStateChange: (state: ExpertCoachState) => void;
  onApplyProposal: (proposal: ExpertCoachProposal) => void;
}) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [messages, setMessages] = useState<ExpertCoachMessage[]>(props.state.messages);
  const [versions, setVersions] = useState<ExpertCoachVersion[]>(props.state.versions);
  const [sessionId, setSessionId] = useState<string | null>(props.state.sessionId);
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [appliedVersionId, setAppliedVersionId] = useState<string | null>(props.state.appliedVersionId);
  const abortRef = useRef<AbortController | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    props.onStateChange({ sessionId, messages, versions, appliedVersionId });
  }, [appliedVersionId, messages, props.onStateChange, sessionId, versions]);

  const applyVersion = (version: ExpertCoachVersion) => {
    props.onApplyProposal(version.proposal);
    setAppliedVersionId(version.id);
  };

  const send = async (retryValue?: string) => {
    const value = (retryValue ?? input).trim();
    if ((!value && attachments.length === 0) || sending) return;
    const userMessage: ExpertCoachMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: value || t("agents.expert_creation_attachment_only", { count: attachments.length }),
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    const submittedAttachments = attachments;
    setAttachments([]);
    const baseUrl = props.opencodeBaseUrl?.trim() ?? "";
    if (!baseUrl) {
      setInput((current) => current.trim() ? current : value);
      setAttachments((current) => mergeExpertChatAttachments(submittedAttachments, current));
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: t("agents.expert_creation_coach_unavailable"),
      }]);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    try {
      const output = await runExpertCoachTurn({
        config: {
          baseUrl,
          token: props.onmyagentServerToken,
          workspaceRoot: props.workspaceRoot,
        },
        sessionId,
        message: value,
        attachments: submittedAttachments,
        draft: props.draft,
        skills: props.skills,
        signal: controller.signal,
      });
      setSessionId(output.sessionId);
      const assistantMessage: ExpertCoachMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: output.result.reply,
        ...(output.result.proposal ? { proposal: output.result.proposal } : {}),
      };
      setMessages((current) => [...current, assistantMessage]);
      const proposal = output.result.proposal;
      if (proposal) {
        setVersions((current) => [{
          id: assistantMessage.id,
          createdAt: Date.now(),
          proposal,
        }, ...current]);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessages((current) => [...current, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: t("agents.expert_creation_coach_stopped"),
        }]);
        return;
      }
      setInput((current) => current.trim() ? current : value);
      setAttachments((current) => mergeExpertChatAttachments(submittedAttachments, current));
      const detail = error instanceof Error ? error.message : "";
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: detail
          ? t("agents.expert_creation_coach_failed_detail", { detail })
          : t("agents.expert_creation_coach_failed"),
      }]);
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  return (
    <aside className="flex min-h-0 w-2/5 min-w-80 shrink-0 border-r border-dls-border bg-dls-background p-5">
      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-dls-border bg-dls-surface p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {renderAvatar(
              props.registry,
              {
                avatarStyle: props.registry.avatars[0]?.style,
                avatarOptionId: props.registry.avatars[0]?.id ?? "",
                name: t("agents.expert_creation_coach"),
              },
              "size-9",
            )}
            <h2 className="truncate text-base font-semibold text-dls-text">
              {t("agents.expert_creation_coach")}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-dls-secondary"
            disabled={versions.length === 0}
            onClick={() => setHistoryOpen(true)}
          >
            <Clock3 data-icon="inline-start" className="size-4" />
            {t("agents.expert_creation_coach_history")}
          </Button>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pt-10">
          <div className="space-y-6 text-sm leading-7 text-dls-text">
            <p>{t("agents.expert_creation_coach_greeting")}</p>
            <p>{t("agents.expert_creation_coach_intro")}</p>
            <p>{t("agents.expert_creation_coach_question")}</p>
            <ol className="list-decimal space-y-1 pl-5">
              {[1, 2, 3, 4].map((index) => (
                <li key={index}>
                  {t(`agents.expert_creation_coach_option_${index}`)}
                </li>
              ))}
            </ol>
            <p>{t("agents.expert_creation_coach_reply_hint")}</p>
            {messages.map((message) => {
              const proposal = message.proposal;
              return (
              <div
                key={message.id}
                className={cn(
                  "max-w-[94%] rounded-xl px-3 py-2.5 leading-6",
                  message.role === "user"
                    ? "ml-auto bg-dls-accent text-white"
                    : "bg-dls-hover text-dls-text",
                )}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {proposal ? (
                  <div className="mt-3 rounded-xl border border-dls-border bg-dls-surface p-3">
                    <p className="font-semibold text-dls-text">{proposal.name}</p>
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-dls-secondary">
                      {proposal.description}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      className="mt-3 w-full"
                      variant={appliedVersionId === message.id ? "secondary" : "default"}
                      onClick={() => applyVersion({
                        id: message.id,
                        createdAt: Date.now(),
                        proposal,
                      })}
                    >
                      {appliedVersionId === message.id
                        ? t("agents.expert_creation_coach_applied")
                        : t("agents.expert_creation_coach_apply")}
                    </Button>
                  </div>
                ) : null}
              </div>
              );
            })}
            {sending ? (
              <div className="max-w-[94%] rounded-xl bg-dls-hover px-3 py-2.5 text-dls-secondary">
                {t("agents.expert_creation_coach_thinking")}
              </div>
            ) : null}
          </div>
        </div>
        <div className="pt-6">
          <div className="relative rounded-2xl border border-dls-border bg-dls-background p-3">
            {attachments.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((file) => (
                  <span key={`${file.name}-${file.size}`} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-dls-hover px-2 py-1 text-xs text-dls-secondary">
                    <span className="max-w-40 truncate">{file.name}</span>
                    <button
                      type="button"
                      className="rounded-md p-0.5 hover:bg-dls-surface"
                      onClick={() => setAttachments((current) => current.filter((item) => item !== file))}
                      aria-label={t("agents.expert_creation_remove_attachment", { name: file.name })}
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <input
              ref={attachmentInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                setAttachments((current) => mergeExpertChatAttachments(current, Array.from(event.currentTarget.files ?? [])));
                event.currentTarget.value = "";
              }}
            />
            <Textarea
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={t("agents.expert_creation_coach_placeholder")}
              className="min-h-16 resize-none border-0 bg-transparent px-1 py-0 pr-1 shadow-none focus-visible:ring-0"
            />
            <div className="mt-2 flex items-center justify-between">
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => attachmentInputRef.current?.click()} aria-label={t("agents.expert_creation_add_attachment")}>
                <Plus className="size-5" aria-hidden />
              </Button>
              <div className="flex items-center gap-1">
                <Button type="button" size="icon-sm" variant="ghost" disabled aria-label={t("agents.expert_creation_coach_mic_unavailable")}>
                  <Mic className="size-5" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={!sending && !input.trim() && attachments.length === 0}
                  onClick={() => sending ? abortRef.current?.abort() : void send()}
                  aria-label={sending
                    ? t("agents.expert_creation_coach_stop")
                    : t("agents.expert_creation_preview_send")}
                >
                  {sending ? <X className="size-5" aria-hidden /> : <Send className="size-5" aria-hidden />}
                </Button>
              </div>
            </div>
          </div>
          <p className="pt-3 text-center text-xs text-dls-secondary">
            {t("agents.expert_creation_coach_disclaimer")}
          </p>
        </div>
      </div>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[78vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("agents.expert_creation_coach_history")}</DialogTitle>
            <DialogDescription>{t("agents.expert_creation_coach_history_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {versions.map((version, index) => (
              <div key={version.id} className="rounded-xl border border-dls-border bg-dls-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-dls-text">{version.proposal.name}</p>
                    <p className="mt-1 text-xs text-dls-secondary">
                      {t("agents.expert_creation_coach_version", { version: versions.length - index })}
                      {" · "}
                      {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(version.createdAt)}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => applyVersion(version)}>
                    {appliedVersionId === version.id
                      ? t("agents.expert_creation_coach_applied")
                      : t("agents.expert_creation_coach_apply")}
                  </Button>
                </div>
                <p className="mt-3 text-sm leading-6 text-dls-secondary">{version.proposal.description}</p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function PromptEditor(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const lineCount = Math.max(8, props.value.split("\n").length);
  return (
    <div className="flex min-h-56 overflow-hidden rounded-xl border border-dls-border bg-dls-background">
      <div
        aria-hidden="true"
        className="select-none border-r border-dls-border px-3 py-3 text-right text-xs leading-6 text-dls-secondary"
      >
        {Array.from({ length: lineCount }, (_, index) => (
          <div key={index}>{index + 1}</div>
        ))}
      </div>
      <Textarea
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel}
        controlSize="editor"
        className="min-h-56 flex-1 resize-none rounded-none border-0 bg-transparent px-4 py-3 shadow-none focus-visible:ring-0"
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

  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);

  const chooseGeneratedAvatar = (avatarId: string) => {
    props.onDraftChange("avatarOptionId", avatarId);
    props.onDraftChange("customAvatarDataUrl", null);
    setAvatarPickerOpen(false);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-dls-border bg-dls-surface p-5">
        <div
          className={cn(
            "grid gap-6 xl:grid-cols-[8.5rem_minmax(0,1fr)]",
            !props.compact && "lg:grid-cols-[8.5rem_minmax(0,1fr)]",
          )}
        >
          <div className="flex flex-col items-start gap-3">
            <button
              type="button"
              className="relative rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              onClick={() => setAvatarPickerOpen(true)}
              aria-label={t("agents.expert_creation_avatar")}
            >
              <ExpertCreationAvatar registry={props.registry} draft={props.draft} className="size-24 text-2xl" />
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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAvatarPickerOpen(true)}
            >
              <UserRound data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_choose_avatar")}
            </Button>
          </div>
          <div className="space-y-4">
            <Input
              value={props.draft.name}
              onChange={(event) => props.onDraftChange("name", event.currentTarget.value)}
              placeholder={t("agents.expert_creation_name_placeholder")}
              variant="dls"
              controlSize="lg"
              radius="xl"
              aria-label={t("agents.name")}
            />
            <Textarea
              value={props.draft.description}
              onChange={(event) => props.onDraftChange("description", event.currentTarget.value)}
              placeholder={t("agents.expert_creation_intro_placeholder")}
              className="min-h-28"
              aria-label={t("agents.expert_creation_intro")}
            />
          </div>
        </div>
      </section>
      <section className="rounded-2xl border border-dls-border bg-dls-surface p-5">
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
      <Dialog open={avatarPickerOpen} onOpenChange={setAvatarPickerOpen}>
        <DialogContent className="w-[min(32rem,calc(100%-2rem))] gap-4 rounded-xl bg-dls-surface p-5 text-dls-text">
          <DialogHeader>
            <DialogTitle>{t("agents.expert_creation_choose_avatar")}</DialogTitle>
            <DialogDescription>{t("agents.expert_creation_avatar_hint")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-3">
            {props.registry.avatars.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                className={cn(
                  "rounded-xl p-2 transition-colors hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                  props.draft.avatarOptionId === avatar.id && !props.draft.customAvatarDataUrl
                    ? "bg-dls-accent/10 ring-2 ring-dls-accent"
                    : "",
                )}
                onClick={() => chooseGeneratedAvatar(avatar.id)}
              >
                {renderAvatar(
                  props.registry,
                  {
                    avatarStyle: avatar.style,
                    avatarOptionId: avatar.id,
                    name: avatar.label,
                  },
                  "mx-auto size-14",
                )}
                <span className="mt-2 block truncate text-xs text-dls-secondary">{avatar.label}</span>
              </button>
            ))}
          </div>
          <Button type="button" variant="outline" onClick={() => uploadInputRef.current?.click()}>
            <Upload data-icon="inline-start" className="size-3.5" />
            {t("agents.upload_custom_image")}
          </Button>
        </DialogContent>
      </Dialog>
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
  const visibleSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return props.skills.filter((skill) => {
      if (!normalized) return true;
      return `${skill.name} ${skill.description} ${skill.category}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [props.skills, query]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[min(40rem,calc(100vh-4rem))] w-[min(42rem,calc(100%-2rem))] gap-4 rounded-xl bg-dls-surface p-5 text-dls-text">
        <DialogHeader>
          <DialogTitle>{t("agents.expert_creation_skill_picker_title")}</DialogTitle>
          <DialogDescription>
            {t("agents.expert_creation_skill_picker_desc")}
          </DialogDescription>
        </DialogHeader>
        <Input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("agents.search_skills")}
          variant="dls"
          controlSize="lg"
          radius="xl"
        />
        <div className="min-h-0 overflow-y-auto">
          <div className="grid gap-2 sm:grid-cols-2">
            {visibleSkills.map((skill) => {
              const selected = props.selectedIds.includes(skill.id);
              return (
                <button
                  key={skill.id}
                  type="button"
                  className={cn(
                    "flex min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                    selected
                      ? "border-dls-accent bg-dls-accent/8"
                      : "border-dls-border bg-dls-background hover:bg-dls-hover",
                  )}
                  onClick={() => props.onToggle(skill.id)}
                >
                  <IconCircle className="size-8 text-xs font-semibold">
                    {localSkillLabel(skill).slice(0, 1).toUpperCase()}
                  </IconCircle>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-dls-text">
                      <span className="truncate">{localSkillLabel(skill)}</span>
                      {selected ? <Check className="size-3.5 shrink-0 text-dls-accent" /> : null}
                    </span>
                    <span className="mt-1 line-clamp-2 text-xs leading-5 text-dls-secondary">
                      {localSkillDescription(skill)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
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
  const inputRef = useRef<HTMLInputElement>(null);
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
          <Button type="button" size="sm" variant="ghost" disabled={props.loading || props.loadError} onClick={() => setPickerOpen(true)}>
            <Plus data-icon="inline-start" className="size-3.5" />
            {t("agents.expert_creation_add_skill")}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".md,.zip"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length > 0) props.onImport(files);
              event.currentTarget.value = "";
            }}
          />
        </div>
      </div>
      {props.loading && selectedSkills.length === 0 ? (
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center rounded-2xl bg-dls-surface px-6 text-center">
          <LoadingSpinner size="default" />
          <p className="mt-4 text-sm text-dls-secondary">{t("agents.expert_creation_loading_skills")}</p>
        </div>
      ) : props.loadError && selectedSkills.length === 0 ? (
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center rounded-2xl bg-dls-surface px-6 text-center">
          <NoticeBox role="alert" tone="error" size="content" className="max-w-md">
            {t("agents.expert_creation_load_skills_failed")}
          </NoticeBox>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={props.onRetryLoad}>
              {t("agents.expert_creation_retry")}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={props.importing} onClick={() => inputRef.current?.click()}>
              <Upload data-icon="inline-start" className="size-3.5" />
              {props.importing ? t("agents.expert_creation_importing") : t("agents.expert_creation_import_skill")}
            </Button>
          </div>
        </div>
      ) : selectedSkills.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {selectedSkills.map((skill) => {
            const selected = props.selectedIds.includes(skill.id);
            return (
              <article key={skill.id} className="min-w-0 rounded-2xl border border-dls-border bg-dls-surface p-5">
                <div className="flex min-w-0 items-start gap-3">
                  <IconCircle className="size-12 shrink-0 border-dls-accent/20 bg-dls-accent/10 text-dls-accent">
                    <SkillGlyphIcon className="size-6" />
                  </IconCircle>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="truncate text-base font-semibold text-dls-text">
                          {localSkillLabel(skill)}
                        </h4>
                        <p className="mt-1 truncate text-sm text-dls-secondary">{skill.name}</p>
                      </div>
                      <Switch
                        size="default"
                        className="data-checked:border-dls-status-orange data-checked:bg-dls-status-orange"
                        checked={selected}
                        onCheckedChange={(checked) => {
                          if (checked !== selected) toggleSkill(skill.id);
                        }}
                        aria-label={localSkillLabel(skill)}
                      />
                    </div>
                    <p className="mt-4 line-clamp-3 text-sm leading-6 text-dls-secondary">
                      {localSkillDescription(skill)}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center rounded-2xl bg-dls-surface px-6 text-center">
          <FileSearch className="size-20 text-dls-secondary" strokeWidth={1.2} aria-hidden />
          <h3 className="mt-5 text-sm font-semibold text-dls-text">{t("agents.expert_creation_no_skills")}</h3>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
              <Plus data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_add_skill")}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={props.importing} onClick={() => inputRef.current?.click()}>
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
    </div>
  );
}

function KnowledgePanel(props: {
  entries: ExpertKnowledgeEntry[];
  onEntriesChange: (entries: ExpertKnowledgeEntry[]) => void;
}) {
  const documentInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [folderError, setFolderError] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");

  const addFiles = (files: File[]) => {
    const validFiles = files.filter((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const directorySegments = relativePath.split("/").slice(0, -1);
      return directorySegments.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment));
    });
    setFolderError(validFiles.length !== files.length);
    if (validFiles.length === 0) return;
    const next = new Map(props.entries.map((entry) => [entry.relativePath, entry]));
    for (const file of validFiles) {
      const relativePath = file.webkitRelativePath || file.name;
      next.set(relativePath, { kind: "file", relativePath, file });
    }
    props.onEntriesChange(Array.from(next.values()));
  };

  const createFolder = () => {
    const name = folderName.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(name.trim())) {
      setFolderError(true);
      return;
    }
    setFolderError(false);
    setFolderDialogOpen(false);
    setFolderName("");
    const relativePath = name.trim();
    if (props.entries.some((entry) => entry.relativePath === relativePath)) return;
    props.onEntriesChange([
      ...props.entries,
      { kind: "directory", relativePath },
    ]);
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
          <Button type="button" size="sm" variant="ghost" onClick={() => {
            setFolderError(false);
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
                <Button type="button" size="sm" variant="outline">
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
      {props.entries.length > 0 ? (
        <div className="space-y-2">
          {props.entries.map((entry) => (
            <div key={entry.relativePath} className="flex items-center gap-3 rounded-lg border border-dls-border bg-dls-surface px-3 py-2.5">
              <IconCircle className="size-8">
                {entry.kind === "directory" ? <FolderPlus className="size-4" /> : <Upload className="size-4" />}
              </IconCircle>
              <span className="min-w-0 flex-1 truncate text-sm text-dls-text">{entry.relativePath}</span>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={() => props.onEntriesChange(props.entries.filter((item) => item.relativePath !== entry.relativePath))}
                aria-label={t("agents.expert_creation_remove_knowledge")}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </div>
          ))}
          <p className="pt-2 text-xs text-dls-secondary">
            {t("agents.expert_creation_knowledge_files", { count: props.entries.length })}
          </p>
        </div>
      ) : (
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center rounded-2xl bg-dls-surface px-6 text-center">
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
            <Button type="button" variant="secondary" size="sm" onClick={() => {
              setFolderError(false);
              setFolderName("");
              setFolderDialogOpen(true);
            }}>
              <FolderPlus data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_create_folder")}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => documentInputRef.current?.click()}>
              <Upload data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_upload_document")}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={openFolderUpload}>
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
                setFolderError(false);
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
            {folderError ? (
              <p className="text-sm text-dls-status-danger-fg">
                {t("agents.expert_creation_folder_name_error")}
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
    </div>
  );
}

function TryEffectPanel(props: {
  draft: AgentWizardDraft;
  registry: AgentRegistry;
  workspaceRoot: string;
  opencodeBaseUrl: string | null;
  onmyagentServerToken: string | null;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [messages, setMessages] = useState<ExpertCoachMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionDraftKey, setSessionDraftKey] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamTextRef = useRef("");
  const draftKey = buildExpertPreviewDraftKey(props.draft);
  const staleSession = Boolean(sessionId && sessionDraftKey && sessionDraftKey !== draftKey);

  const updateStreamText = (text: string) => {
    streamTextRef.current = text;
    setStreamText(text);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamText]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const value = input.trim();
    const baseUrl = props.opencodeBaseUrl?.trim() ?? "";
    if ((!value && attachments.length === 0) || !baseUrl || sending || !props.draft.name.trim()) return;
    if (staleSession) setMessages([]);
    setMessages((current) => [...current, {
      id: crypto.randomUUID(),
      role: "user",
      content: value || t("agents.expert_creation_attachment_only", { count: attachments.length }),
    }]);
    setInput("");
    const submittedAttachments = attachments;
    setAttachments([]);
    updateStreamText("");
    setSending(true);
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await runExpertPreviewTurn({
        config: {
          baseUrl,
          token: props.onmyagentServerToken,
          workspaceRoot: props.workspaceRoot,
        },
        sessionId: staleSession ? null : sessionId,
        message: value,
        attachments: submittedAttachments,
        draft: props.draft,
        signal: controller.signal,
        onTextChange: updateStreamText,
      });
      if (runIdRef.current !== runId) return;
      setSessionId(result.sessionId);
      setSessionDraftKey(draftKey);
      if (result.content.trim()) {
        setMessages((current) => [...current, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.content,
        }]);
      }
      updateStreamText("");
    } catch (error) {
      if (runIdRef.current !== runId) return;
      if (error instanceof DOMException && error.name === "AbortError") {
        const partial = streamTextRef.current.trim();
        setMessages((current) => [...current, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: partial
            ? `${partial}\n\n${t("agents.expert_creation_preview_stopped")}`
            : t("agents.expert_creation_preview_stopped"),
        }]);
        updateStreamText("");
        return;
      }
      setInput((current) => current.trim() ? current : value);
      setAttachments((current) => mergeExpertChatAttachments(submittedAttachments, current));
      const detail = error instanceof Error ? error.message : "";
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: detail
          ? t("agents.expert_creation_preview_failed_detail", { detail })
          : t("agents.expert_creation_preview_failed"),
      }]);
      updateStreamText("");
    } finally {
      if (runIdRef.current !== runId) return;
      abortRef.current = null;
      setSending(false);
    }
  };

  const startNewSession = () => {
    runIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setSessionId(null);
    setSessionDraftKey(null);
    setMessages([]);
    updateStreamText("");
    setInput("");
    setAttachments([]);
  };

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-l border-dls-border bg-dls-surface">
      <div className="flex items-center gap-2 border-b border-dls-border px-5 py-4">
        <Button type="button" variant="ghost" size="icon-sm" onClick={props.onClose} aria-label={t("agents.expert_creation_back")}>
          <ChevronsLeft className="size-5" aria-hidden />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-dls-text">
          {t("agents.expert_creation_preview_title")}
        </h2>
        <Button type="button" variant="ghost" size="icon-sm" onClick={startNewSession} aria-label={t("agents.expert_creation_preview_new_session")}>
          <Plus className="size-5" aria-hidden />
        </Button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {staleSession ? (
          <NoticeBox tone="info" size="content" className="mb-4">
            {t("agents.expert_creation_preview_config_changed")}
          </NoticeBox>
        ) : null}
        {props.draft.name.trim() ? (
          <div className="space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "max-w-[90%] whitespace-pre-wrap rounded-xl px-3 py-2.5 text-sm leading-6",
                  message.role === "user"
                    ? "ml-auto bg-dls-accent text-white"
                    : "bg-dls-hover text-dls-text",
                )}
              >
                {message.content}
              </div>
            ))}
            {streamText ? (
              <div className="max-w-[90%] whitespace-pre-wrap rounded-xl bg-dls-hover px-3 py-2.5 text-sm leading-6 text-dls-text">
                {streamText}
              </div>
            ) : sending ? (
              <div className="max-w-[90%] rounded-xl bg-dls-hover px-3 py-2.5 text-sm leading-6 text-dls-secondary">
                {t("agents.expert_creation_coach_thinking")}
              </div>
            ) : null}
            {messages.length === 0 && !sending ? (
              <div className="flex h-full min-h-64 flex-col items-center justify-center text-center text-sm leading-6 text-dls-secondary">
                <ExpertCreationAvatar registry={props.registry} draft={props.draft} className="size-20" />
                <span className="mt-4 max-w-44">{t("agents.expert_creation_preview_ready")}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full min-h-64 flex-col items-center justify-center text-center text-sm leading-6 text-dls-secondary">
            <ExpertCreationAvatar registry={props.registry} draft={props.draft} className="size-20" />
            <span className="mt-4 max-w-44">{t("agents.expert_creation_preview_empty")}</span>
          </div>
        )}
      </div>
      <div className="border-t border-dls-border p-4">
        <div className="relative rounded-2xl border border-dls-border bg-dls-background p-3">
          {attachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((file) => (
                <span key={`${file.name}-${file.size}`} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-dls-hover px-2 py-1 text-xs text-dls-secondary">
                  <span className="max-w-32 truncate">{file.name}</span>
                  <button
                    type="button"
                    className="rounded-md p-0.5 hover:bg-dls-surface"
                    onClick={() => setAttachments((current) => current.filter((item) => item !== file))}
                    aria-label={t("agents.expert_creation_remove_attachment", { name: file.name })}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              setAttachments((current) => mergeExpertChatAttachments(current, Array.from(event.currentTarget.files ?? [])));
              event.currentTarget.value = "";
            }}
          />
          <Textarea
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            disabled={!props.draft.name.trim()}
            placeholder={t("agents.expert_creation_preview_placeholder")}
            className="min-h-12 resize-none border-0 bg-transparent px-1 py-0 pr-1 shadow-none focus-visible:ring-0"
          />
          <div className="mt-2 flex items-center justify-between">
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => attachmentInputRef.current?.click()} aria-label={t("agents.expert_creation_add_attachment")}>
              <Plus className="size-5" aria-hidden />
            </Button>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                disabled={!sending && ((!input.trim() && attachments.length === 0) || !props.draft.name.trim() || !props.opencodeBaseUrl?.trim())}
                onClick={() => sending ? abortRef.current?.abort() : void send()}
                aria-label={sending
                  ? t("agents.expert_creation_coach_stop")
                  : t("agents.expert_creation_preview_send")}
              >
                {sending ? <X className="size-5" aria-hidden /> : <Send className="size-5" aria-hidden />}
              </Button>
            </div>
          </div>
        </div>
      </div>
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
  const [coachState, setCoachState] = useState(storedInitialState.coach);
  const [availableSkills, setAvailableSkills] = useState(() =>
    props.skills.filter((skill) => skill.enabled),
  );
  const [knowledge, setKnowledge] = useState<ExpertKnowledgeEntry[]>([]);
  const [tryOpen, setTryOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsLoadError, setSkillsLoadError] = useState(false);
  const [skillsReloadToken, setSkillsReloadToken] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    writeExpertCreationStoredState(props.workspaceId, { draft, coach: coachState });
  }, [coachState, draft, props.workspaceId]);

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
      await props.onDone(draft, knowledge, availableSkills);
      clearExpertCreationStoredState(props.workspaceId);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("agents.expert_creation_create_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const requestClose = () => {
    if (submitting) return;
    if (hasExpertCreationProgress(draft, baselineDraft, coachState, knowledge.length)) {
      setExitDialogOpen(true);
      return;
    }
    props.onClose();
  };

  const discardAndClose = () => {
    clearExpertCreationStoredState(props.workspaceId);
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
      <div className="flex min-h-0 flex-1">
        <ExpertCoach
          registry={sourceRegistry}
          draft={draft}
          skills={availableSkills}
          workspaceRoot={props.workspaceRoot}
          opencodeBaseUrl={props.opencodeBaseUrl}
          onmyagentServerToken={props.onmyagentServerToken}
          state={coachState}
          onStateChange={setCoachState}
          onApplyProposal={(proposal) => {
            setDraft((current) => applyExpertCoachProposal(current, proposal, availableSkills));
          }}
        />
        <main className="flex min-w-0 flex-1 flex-col bg-dls-background">
          <div className="flex items-center justify-between gap-3 border-b border-dls-border bg-dls-surface px-5 py-3">
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
              <Button type="button" variant="outline" size="sm" onClick={() => setTryOpen(true)}>
                <ChevronsLeft data-icon="inline-start" className="size-4" />
                {t("agents.expert_creation_try")}
              </Button>
            ) : null}
          </div>
          <div className={cn("flex min-h-0 flex-1", tryOpen && "grid grid-cols-[minmax(0,1fr)_minmax(19rem,30%)]")}>
            <section className="min-w-0 flex-1 overflow-y-auto px-6 py-6 xl:px-10">
              <div className="w-full">
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
                  <section className="rounded-2xl border border-dls-border bg-dls-surface p-5">
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
                  <KnowledgePanel entries={knowledge} onEntriesChange={setKnowledge} />
                ) : null}
              </div>
            </section>
            {tryOpen ? (
              <TryEffectPanel
                draft={draft}
                registry={sourceRegistry}
                workspaceRoot={props.workspaceRoot}
                opencodeBaseUrl={props.opencodeBaseUrl}
                onmyagentServerToken={props.onmyagentServerToken}
                onClose={() => setTryOpen(false)}
              />
            ) : null}
          </div>
        </main>
      </div>
      <ExpertCreationExitDialog
        open={exitDialogOpen}
        hasKnowledge={knowledge.length > 0}
        onContinue={() => setExitDialogOpen(false)}
        onKeepAndExit={() => {
          setExitDialogOpen(false);
          props.onClose();
        }}
        onDiscardAndExit={discardAndClose}
      />
    </div>
  );
}
