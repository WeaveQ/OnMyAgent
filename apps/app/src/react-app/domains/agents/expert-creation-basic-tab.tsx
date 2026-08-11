/** @jsxImportSource react */
import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AgentRegistry, AgentWizardDraft } from "./agent-registry";
import { ExpertCreationAvatar } from "./expert-creation-view-primitives";
import {
  EXPERT_FORM_FIELD_CLASS,
  EXPERT_FORM_SECTION_CLASS,
} from "./expert-creation-view-constants";

export function PromptEditor(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  /** Optional expandable writing framework under the editor chrome. */
  framework?: string;
}) {
  const [frameworkOpen, setFrameworkOpen] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-dls-border/70 bg-dls-background focus-within:border-dls-accent/50 focus-within:ring-3 focus-within:ring-ring/25">
        <Textarea
          value={props.value}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          placeholder={props.placeholder}
          aria-label={props.ariaLabel}
          controlSize="editor"
          className={cn(
            "min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent px-4 py-3.5 leading-6 shadow-none focus-visible:ring-0",
            EXPERT_FORM_FIELD_CLASS,
          )}
        />
      </div>
      {props.framework ? (
        <div className="shrink-0">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-dls-secondary transition-colors hover:text-dls-text"
            aria-expanded={frameworkOpen}
            onClick={() => setFrameworkOpen((open) => !open)}
          >
            {frameworkOpen ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
            {frameworkOpen
              ? t("agents.expert_creation_role_prompt_hide_framework")
              : t("agents.expert_creation_role_prompt_show_framework")}
          </button>
          {frameworkOpen ? (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-dls-border/50 bg-dls-surface-muted/40 px-3.5 py-3 font-sans text-xs leading-5 text-dls-secondary">
              {props.framework}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function BasicInfoPanel(props: {
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
      <section className={cn("shrink-0", EXPERT_FORM_SECTION_CLASS)}>
        <div
          className={cn(
            "grid items-start gap-5 xl:grid-cols-[5.75rem_minmax(0,1fr)]",
            !props.compact && "lg:grid-cols-[5.75rem_minmax(0,1fr)]",
          )}
        >
          <div className="flex flex-col items-center gap-2 pt-0.5">
            <button
              type="button"
              className="group relative rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              onClick={() => uploadInputRef.current?.click()}
              aria-label={t("agents.expert_creation_avatar")}
            >
              <ExpertCreationAvatar
                registry={props.registry}
                draft={props.draft}
                className="size-[4.75rem] text-xl ring-1 ring-dls-border/60 ring-offset-2 ring-offset-dls-surface"
              />
              <span className="absolute -bottom-0.5 -right-0.5 inline-flex size-6 items-center justify-center rounded-full border-2 border-dls-surface bg-dls-text text-dls-surface shadow-sm transition-transform group-hover:scale-105">
                <Plus className="size-3.5" aria-hidden />
              </span>
            </button>
            <span className="whitespace-nowrap text-center text-2xs leading-4 text-dls-secondary">
              {t("agents.expert_creation_avatar_hint")}
            </span>
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
          <div className="min-w-0 space-y-3.5">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-dls-secondary">
                {t("agents.name")}
                <span className="ml-0.5 text-dls-danger" aria-hidden>
                  *
                </span>
              </span>
              <Input
                value={props.draft.name}
                onChange={(event) =>
                  props.onDraftChange("name", event.currentTarget.value)
                }
                placeholder={t("agents.expert_creation_name_placeholder")}
                variant="dls"
                controlSize="lg"
                radius="xl"
                className={EXPERT_FORM_FIELD_CLASS}
                aria-label={t("agents.name")}
                required
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-dls-secondary">
                {t("agents.expert_creation_intro")}
              </span>
              <Textarea
                value={props.draft.description}
                onChange={(event) =>
                  props.onDraftChange("description", event.currentTarget.value)
                }
                placeholder={t("agents.expert_creation_intro_placeholder")}
                className={cn(
                  "min-h-[5.25rem] leading-6",
                  EXPERT_FORM_FIELD_CLASS,
                )}
                aria-label={t("agents.expert_creation_intro")}
              />
            </label>
          </div>
        </div>
      </section>
      <section
        className={cn("flex min-h-0 flex-1 flex-col", EXPERT_FORM_SECTION_CLASS)}
      >
        <div className="mb-3 shrink-0">
          <h3 className="text-base font-semibold leading-6 text-dls-text">
            {t("agents.expert_creation_role_prompt")}
          </h3>
          <p className="mt-1 max-w-[52ch] text-sm leading-6 text-dls-secondary">
            {t("agents.expert_creation_role_prompt_desc")}
          </p>
        </div>
        <PromptEditor
          value={props.draft.userNote}
          onChange={(value) => props.onDraftChange("userNote", value)}
          placeholder={t("agents.expert_creation_role_prompt_placeholder")}
          ariaLabel={t("agents.expert_creation_role_prompt")}
          framework={t("agents.expert_creation_role_prompt_framework")}
        />
      </section>
    </div>
  );
}
