/** @jsxImportSource react */
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  FolderPlus,
  ImagePlus,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Upload,
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
import { Input } from "@/components/ui/input";
import {
  NavTabButton,
  SegmentedTabGroup,
} from "@/components/ui/action-row";
import { Textarea } from "@/components/ui/textarea";
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

export type ExpertCreationTab = "basic" | "memory" | "skills" | "knowledge";

export type ExpertKnowledgeEntry = {
  kind: "file" | "directory";
  relativePath: string;
  file?: File;
};

export type ExpertCreationPageProps = {
  workspaceId: string;
  workspaceRoot: string;
  client: OnMyAgentServerClient | null;
  registry: AgentRegistry | null;
  skills: AgentSkillItem[];
  onClose: () => void;
  onTry: (draft: AgentWizardDraft) => void;
  onDone: (
    draft: AgentWizardDraft,
    knowledge: ExpertKnowledgeEntry[],
  ) => Promise<void>;
};

type CoachMessage = {
  role: "assistant" | "user";
  content: string;
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

function ExpertCoach() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<CoachMessage[]>([
    { role: "assistant", content: t("agents.expert_creation_coach_welcome") },
  ]);

  const send = () => {
    const value = input.trim();
    if (!value) return;
    setMessages((current) => [
      ...current,
      { role: "user", content: value },
      {
        role: "assistant",
        content: t("agents.expert_creation_coach_welcome"),
      },
    ]);
    setInput("");
  };

  return (
    <aside className="flex min-h-0 w-[19rem] shrink-0 flex-col border-r border-dls-border bg-dls-surface">
      <div className="flex items-center gap-3 border-b border-dls-border px-5 py-4">
        <IconCircle className="border-dls-accent/25 bg-dls-accent/10 text-dls-accent">
          <Sparkles className="size-4" aria-hidden />
        </IconCircle>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-dls-text">
            {t("agents.expert_creation_coach")}
          </h2>
          <p className="mt-0.5 text-xs text-dls-secondary">
            {t("agents.expert_creation_coach_desc")}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={cn(
              "max-w-[94%] rounded-xl px-3 py-2.5 text-sm leading-6",
              message.role === "user"
                ? "ml-auto bg-dls-accent text-white"
                : "bg-dls-hover text-dls-text",
            )}
          >
            {message.content}
          </div>
        ))}
      </div>
      <div className="border-t border-dls-border p-4">
        <div className="relative">
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
            className="min-h-20 resize-none pr-11"
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="absolute bottom-2 right-2"
            disabled={!input.trim()}
            onClick={send}
            aria-label={t("agents.expert_creation_preview_send")}
          >
            <Send className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </aside>
  );
}

function BasicInfoPanel(props: {
  draft: AgentWizardDraft;
  registry: AgentRegistry;
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
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="text-sm font-medium text-dls-text">
            {t("agents.avatar")}
          </div>
          <div className="flex items-center gap-4">
            {renderAvatar(
              props.registry,
              {
                avatarStyle: props.draft.avatarStyle,
                avatarOptionId: props.draft.avatarOptionId,
                customAvatarDataUrl: props.draft.customAvatarDataUrl,
                name: props.draft.name,
              },
              "size-20 text-2xl",
            )}
            <div className="min-w-0 space-y-2">
              <p className="text-xs leading-5 text-dls-secondary">
                {t("agents.expert_creation_avatar_hint")}
              </p>
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
                variant="outline"
                size="sm"
                onClick={() => uploadInputRef.current?.click()}
              >
                <ImagePlus data-icon="inline-start" className="size-3.5" />
                {t("agents.upload_custom_image")}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {props.registry.avatars.slice(0, 8).map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                className={cn(
                  "rounded-full ring-offset-2 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent",
                  props.draft.avatarOptionId === avatar.id &&
                    "ring-2 ring-dls-accent",
                )}
                onClick={() => {
                  props.onDraftChange("avatarOptionId", avatar.id);
                  props.onDraftChange("customAvatarDataUrl", null);
                }}
                aria-label={avatar.label}
              >
                {renderAvatar(
                  props.registry,
                  {
                    avatarStyle: avatar.style,
                    avatarOptionId: avatar.id,
                    name: props.draft.name,
                  },
                  "size-8",
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-5">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-dls-text">
              {t("agents.name")} <span className="text-dls-status-danger">*</span>
            </span>
            <Input
              value={props.draft.name}
              onChange={(event) => props.onDraftChange("name", event.currentTarget.value)}
              placeholder={t("agents.name_placeholder")}
              variant="dls"
              controlSize="lg"
              radius="xl"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-dls-text">
              {t("agents.expert_creation_intro")}
            </span>
            <Textarea
              value={props.draft.description}
              onChange={(event) => props.onDraftChange("description", event.currentTarget.value)}
              placeholder={t("agents.expert_creation_intro_placeholder")}
              className="min-h-24"
            />
          </label>
        </div>
      </div>
      <label className="block space-y-2">
        <span className="text-sm font-medium text-dls-text">
          {t("agents.expert_creation_role_prompt")}
        </span>
        <Textarea
          value={props.draft.userNote}
          onChange={(event) => props.onDraftChange("userNote", event.currentTarget.value)}
          placeholder={t("agents.expert_creation_role_prompt_placeholder")}
          controlSize="editor"
        />
      </label>
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
        <div>
          <h3 className="text-base font-semibold text-dls-text">{t("agents.expert_creation_skills")}</h3>
          <p className="mt-1 text-sm text-dls-secondary">{t("agents.expert_creation_skill_picker_desc")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => setPickerOpen(true)}>
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.importing}
            onClick={() => inputRef.current?.click()}
          >
            <Upload data-icon="inline-start" className="size-3.5" />
            {props.importing
              ? t("agents.expert_creation_importing")
              : t("agents.expert_creation_import_skill")}
          </Button>
        </div>
      </div>
      {selectedSkills.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {selectedSkills.map((skill) => (
            <article key={skill.id} className="flex min-w-0 gap-3 rounded-xl border border-dls-border bg-dls-surface p-4">
              <IconCircle className="size-10 shrink-0 text-xs font-semibold">
                {localSkillLabel(skill).slice(0, 1).toUpperCase()}
              </IconCircle>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="truncate text-sm font-semibold text-dls-text">{localSkillLabel(skill)}</h4>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => toggleSkill(skill.id)}
                    aria-label={t("agents.expert_creation_remove_skill")}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </div>
                <p className="mt-1 line-clamp-3 text-xs leading-5 text-dls-secondary">
                  {localSkillDescription(skill)}
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-dls-border bg-dls-surface-muted px-6 text-center">
          <IconCircle className="size-12 bg-dls-surface text-dls-secondary">
            <Sparkles className="size-5" aria-hidden />
          </IconCircle>
          <h3 className="mt-4 text-sm font-semibold text-dls-text">{t("agents.expert_creation_no_skills")}</h3>
          <p className="mt-1 max-w-sm text-sm leading-6 text-dls-secondary">{t("agents.expert_creation_no_skills_desc")}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              <Plus data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_add_skill")}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={props.importing} onClick={() => inputRef.current?.click()}>
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

  const addFiles = (files: File[]) => {
    const next = new Map(props.entries.map((entry) => [entry.relativePath, entry]));
    for (const file of files) {
      const relativePath = file.webkitRelativePath || file.name;
      next.set(relativePath, { kind: "file", relativePath, file });
    }
    props.onEntriesChange(Array.from(next.values()));
  };

  const createFolder = () => {
    const name = window.prompt(t("agents.expert_creation_folder_name"), "");
    if (!name) return;
    if (!/^[A-Za-z0-9_-]+$/.test(name.trim())) {
      setFolderError(true);
      return;
    }
    setFolderError(false);
    const relativePath = name.trim();
    if (props.entries.some((entry) => entry.relativePath === relativePath)) return;
    props.onEntriesChange([
      ...props.entries,
      { kind: "directory", relativePath },
    ]);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-dls-text">{t("agents.expert_creation_knowledge")}</h3>
          <p className="mt-1 text-sm text-dls-secondary">{t("agents.expert_creation_knowledge_empty_desc")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={createFolder}>
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
          <Button type="button" size="sm" variant="outline" onClick={() => documentInputRef.current?.click()}>
            <Upload data-icon="inline-start" className="size-3.5" />
            {t("agents.expert_creation_upload_document")}
          </Button>
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              folderInputRef.current?.setAttribute("webkitdirectory", "");
              folderInputRef.current?.click();
            }}
          >
            <FolderPlus data-icon="inline-start" className="size-3.5" />
            {t("agents.expert_creation_upload_folder")}
          </Button>
        </div>
      </div>
      {folderError ? (
        <p className="text-sm text-dls-status-danger-fg">
          {t("agents.expert_creation_folder_name_error")}
        </p>
      ) : null}
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
                aria-label={t("agents.expert_creation_remove_skill")}
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
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-dls-border bg-dls-surface-muted px-6 text-center">
          <IconCircle className="size-12 bg-dls-surface text-dls-secondary">
            <FolderPlus className="size-5" aria-hidden />
          </IconCircle>
          <h3 className="mt-4 text-sm font-semibold text-dls-text">{t("agents.expert_creation_knowledge_empty")}</h3>
          <p className="mt-1 max-w-sm text-sm leading-6 text-dls-secondary">{t("agents.expert_creation_knowledge_empty_desc")}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={createFolder}>
              <FolderPlus data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_create_folder")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => documentInputRef.current?.click()}>
              <Upload data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_upload_document")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              folderInputRef.current?.setAttribute("webkitdirectory", "");
              folderInputRef.current?.click();
            }}>
              <FolderPlus data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_upload_folder")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TryEffectPanel(props: {
  draft: AgentWizardDraft;
  onTry: (draft: AgentWizardDraft) => void;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<string[]>([]);

  const send = () => {
    const value = input.trim();
    if (!value) return;
    props.onTry(props.draft);
    setMessages((current) => [...current, value]);
    setInput("");
  };

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-l border-dls-border bg-dls-surface">
      <div className="flex items-center gap-3 border-b border-dls-border px-5 py-4">
        <IconCircle className="border-dls-accent/25 bg-dls-accent/10 text-dls-accent">
          <Sparkles className="size-4" aria-hidden />
        </IconCircle>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-dls-text">{t("agents.expert_creation_preview_title")}</h2>
          <p className="mt-0.5 truncate text-xs text-dls-secondary">{props.draft.name || t("agents.expert_creation_title")}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {props.draft.name.trim() ? (
          <div className="space-y-3">
            {messages.map((message, index) => (
              <div key={`${message}-${index}`} className="ml-auto max-w-[90%] rounded-xl bg-dls-accent px-3 py-2.5 text-sm leading-6 text-white">
                {message}
              </div>
            ))}
            {messages.length === 0 ? (
              <div className="flex h-full min-h-64 items-center justify-center text-center text-sm leading-6 text-dls-secondary">
                {t("agents.expert_creation_preview_empty")}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full min-h-64 items-center justify-center text-center text-sm leading-6 text-dls-secondary">
            {t("agents.expert_creation_preview_empty")}
          </div>
        )}
      </div>
      <div className="border-t border-dls-border p-4">
        <div className="relative">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            disabled={!props.draft.name.trim()}
            placeholder={t("agents.expert_creation_preview_placeholder")}
            className="min-h-20 resize-none pr-11"
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="absolute bottom-2 right-2"
            disabled={!input.trim() || !props.draft.name.trim()}
            onClick={send}
            aria-label={t("agents.expert_creation_preview_send")}
          >
            <Send className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </aside>
  );
}

export function ExpertCreationPage(props: ExpertCreationPageProps) {
  const sourceRegistry = props.registry ?? createDefaultAgentRegistry();
  const [activeTab, setActiveTab] = useState<ExpertCreationTab>("basic");
  const [draft, setDraft] = useState(() => buildInitialDraft(props.registry, props.skills));
  const [availableSkills, setAvailableSkills] = useState(() =>
    props.skills.filter((skill) => skill.enabled),
  );
  const [knowledge, setKnowledge] = useState<ExpertKnowledgeEntry[]>([]);
  const [tryOpen, setTryOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(true);
  const [importing, setImporting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadSkills = async () => {
      let localSkills: LocalSkillSummary[] = [];
      if (props.client && props.workspaceId.trim()) {
        try {
          const result = await props.client.listSkills(props.workspaceId, {
            includeGlobal: true,
          });
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
        try {
          const result: unknown = await listLocalSkills(props.workspaceRoot);
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
    };
    void loadSkills();
    return () => {
      cancelled = true;
    };
  }, [props.client, props.skills, props.workspaceId, props.workspaceRoot]);

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
    if (!draft.name.trim()) {
      setSubmitError(t("agents.expert_creation_name_required"));
      setActiveTab("basic");
      return;
    }
    setSubmitError(null);
    try {
      await props.onDone(draft, knowledge);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("agents.expert_creation_saving"));
    }
  };

  const selectedIds = draft.skillIds;

  return (
    <div className="absolute inset-0 z-50 flex min-h-0 flex-col bg-dls-background text-dls-text">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-dls-border bg-dls-surface px-5">
        <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
          <ArrowLeft data-icon="inline-start" className="size-4" />
          {t("agents.expert_creation_back")}
        </Button>
        <h1 className="text-sm font-semibold text-dls-text">{t("agents.expert_creation_title")}</h1>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setTryOpen((current) => !current)}>
            <Sparkles data-icon="inline-start" className="size-3.5" />
            {t("agents.expert_creation_try")}
          </Button>
          <Button type="button" size="sm" disabled={!draft.name.trim()} onClick={() => void submit()}>
            <Check data-icon="inline-start" className="size-3.5" />
            {t("agents.expert_creation_done")}
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {coachOpen ? <ExpertCoach /> : null}
        <main className="flex min-w-0 flex-1 flex-col">
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
            <Button type="button" variant="ghost" size="sm" onClick={() => setCoachOpen((current) => !current)}>
              {coachOpen ? t("agents.expert_creation_back") : t("agents.expert_creation_coach")}
            </Button>
          </div>
          <div className={cn("flex min-h-0 flex-1", tryOpen && "grid grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]")}>
            <section className="min-w-0 overflow-y-auto px-6 py-6 xl:px-10">
              <div className="mx-auto w-full max-w-5xl">
                {activeTab === "basic" ? (
                  <BasicInfoPanel
                    draft={draft}
                    registry={sourceRegistry}
                    onDraftChange={setDraftField}
                  />
                ) : null}
                {activeTab === "memory" ? (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-dls-text">{t("agents.expert_creation_memory")}</span>
                    <Textarea
                      value={draft.agentMemory}
                      onChange={(event) => setDraftField("agentMemory", event.currentTarget.value)}
                      placeholder={t("agents.expert_creation_memory_placeholder")}
                      controlSize="largeEditor"
                    />
                  </label>
                ) : null}
                {activeTab === "skills" ? (
                  <SkillsPanel
                    skills={availableSkills}
                    selectedIds={selectedIds}
                    onSelectedIdsChange={(ids) => setDraftField("skillIds", ids)}
                    onImport={(files) => void importSkillPackage(files)}
                    importing={importing}
                  />
                ) : null}
                {activeTab === "knowledge" ? (
                  <KnowledgePanel entries={knowledge} onEntriesChange={setKnowledge} />
                ) : null}
                {submitError ? <p className="mt-4 text-sm text-dls-status-danger-fg">{submitError}</p> : null}
              </div>
            </section>
            {tryOpen ? <TryEffectPanel draft={draft} onTry={props.onTry} /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}
