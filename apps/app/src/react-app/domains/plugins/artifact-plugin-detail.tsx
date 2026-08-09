/** @jsxImportSource react */
import type { ReactNode } from "react";
import { FileText, Lightbulb, MessageCircle } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { BUILTIN_PLUGIN_ICON_PNG_BY_ID } from "@/react-app/design-system/koboyo-product-icons";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";

import { t } from "@/i18n";

import type { ArtifactPluginDetail as ArtifactPluginDetailModel } from "./artifact-plugin-client";

export type ArtifactPluginDetailLabels = {
  pluginEnabled: string;
  skillEnabled: (name: string) => string;
  starterPrompts: string;
  skills: string;
  unavailable: string;
  enabled: string;
  disabled: string;
};

export type ArtifactPluginDetailProps = {
  plugin: ArtifactPluginDetailModel;
  labels: ArtifactPluginDetailLabels;
  onSelectPrompt: (pluginId: string, skillId: string, prompt: string) => void;
  /** Kept for call-site compatibility; enablement is on the market card. */
  onPluginEnabledChange?: (enabled: boolean) => Promise<void>;
  onSkillEnabledChange?: (skillId: string, enabled: boolean) => Promise<void>;
  starterPromptsDisabled?: boolean;
};

export type ArtifactStarterPromptsProps = {
  pluginId: string;
  skillId: string;
  prompts: string[];
  onSelectPrompt: (pluginId: string, skillId: string, prompt: string) => void;
  disabled?: boolean;
};

/**
 * Soft-UI full-color app marks (Imagine PNGs). Fall back to solid brand tiles
 * only when no product PNG is mapped.
 */
const PLUGIN_FALLBACK_TILE: Record<string, string> = {
  browser: "bg-[#4285F4] text-white shadow-sm shadow-sky-500/25",
  documents: "bg-[#2B579A] text-white shadow-sm shadow-blue-900/20",
  pdf: "bg-[#E5252A] text-white shadow-sm shadow-red-600/25",
  spreadsheets: "bg-[#217346] text-white shadow-sm shadow-emerald-900/20",
};

export function ArtifactPluginIcon({
  pluginId,
  size = "md",
  className,
}: {
  pluginId: string;
  size?: "sm" | "md";
  className?: string;
}) {
  // Match skills marketplace marks: size-9 + rounded-md (not soft-UI squircle xl).
  const box = size === "sm" ? "size-9 rounded-md" : "size-11 rounded-lg";
  const pngSrc = BUILTIN_PLUGIN_ICON_PNG_BY_ID[pluginId];

  if (pngSrc) {
    return (
      <img
        src={resolvePublicAssetUrl(pngSrc)}
        alt=""
        loading="lazy"
        className={cn(box, "shrink-0 object-cover", className)}
        aria-hidden="true"
      />
    );
  }

  const tile =
    PLUGIN_FALLBACK_TILE[pluginId] ?? "bg-dls-text text-dls-background";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        box,
        tile,
        className,
      )}
      aria-hidden="true"
    >
      <FileText className="size-4 text-white" strokeWidth={2} />
    </span>
  );
}

/**
 * “试试这样用” prompt list — full-width quote chips with chat affordance
 * (matches skill/store try-this UX).
 */
export function ArtifactStarterPrompts(props: ArtifactStarterPromptsProps) {
  return (
    <div className="space-y-2">
      {props.prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          data-artifact-prompt={prompt}
          disabled={props.disabled}
          onClick={() => props.onSelectPrompt(props.pluginId, props.skillId, prompt)}
          className={cn(
            "flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left transition-colors",
            "bg-dls-surface-muted/70 hover:bg-dls-surface-muted",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-dls-surface-muted/70",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
          )}
        >
          <span className="min-w-0 flex-1 text-sm leading-6 text-dls-secondary">
            “{prompt}”
          </span>
          <MessageCircle
            className="mt-0.5 size-4 shrink-0 text-dls-secondary/80"
            aria-hidden
          />
        </button>
      ))}
    </div>
  );
}

/** Shared section chrome for try-this prompt lists (artifact + extension details). */
export function TryThisPromptsSection(props: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", props.className)}>
      <h3 className="flex items-center gap-2 text-sm font-medium text-dls-text">
        <Lightbulb className="size-4 shrink-0 text-dls-secondary" aria-hidden />
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

/** Locale overlay for manifest English copy (name / long desc / try-this prompts). */
const LOCALIZED_PLUGIN_DETAIL: Record<
  string,
  {
    nameKey: string;
    longDescKey: string;
    promptKeys: readonly [string, string, string];
  }
> = {
  browser: {
    nameKey: "plugins.artifact_plugin_browser_name",
    longDescKey: "plugins.artifact_plugin_browser_long",
    promptKeys: [
      "plugins.artifact_plugin_browser_prompt_1",
      "plugins.artifact_plugin_browser_prompt_2",
      "plugins.artifact_plugin_browser_prompt_3",
    ],
  },
  documents: {
    nameKey: "plugins.artifact_plugin_documents_name",
    longDescKey: "plugins.artifact_plugin_documents_long",
    promptKeys: [
      "plugins.artifact_plugin_documents_prompt_1",
      "plugins.artifact_plugin_documents_prompt_2",
      "plugins.artifact_plugin_documents_prompt_3",
    ],
  },
  pdf: {
    nameKey: "plugins.artifact_plugin_pdf_name",
    longDescKey: "plugins.artifact_plugin_pdf_long",
    promptKeys: [
      "plugins.artifact_plugin_pdf_prompt_1",
      "plugins.artifact_plugin_pdf_prompt_2",
      "plugins.artifact_plugin_pdf_prompt_3",
    ],
  },
  spreadsheets: {
    nameKey: "plugins.artifact_plugin_spreadsheets_name",
    longDescKey: "plugins.artifact_plugin_spreadsheets_long",
    promptKeys: [
      "plugins.artifact_plugin_spreadsheets_prompt_1",
      "plugins.artifact_plugin_spreadsheets_prompt_2",
      "plugins.artifact_plugin_spreadsheets_prompt_3",
    ],
  },
};

type ArtifactPluginCopySource = {
  id: string;
  manifest: ArtifactPluginDetailModel["manifest"];
};

function localizedPluginDetail(plugin: ArtifactPluginCopySource) {
  const keys = LOCALIZED_PLUGIN_DETAIL[plugin.id];
  if (!keys) {
    return {
      title: plugin.manifest.interface.displayName,
      longDescription: plugin.manifest.interface.longDescription,
      prompts: plugin.manifest.interface.defaultPrompt ?? [],
    };
  }
  return {
    title: t(keys.nameKey),
    longDescription: t(keys.longDescKey),
    prompts: keys.promptKeys.map((key) => t(key)),
  };
}

/** Shared copy for market card → connect dialog (Feishu-style shell). */
export function getArtifactPluginConnectCopy(
  plugin: ArtifactPluginCopySource,
): { title: string; longDescription: string; prompts: string[] } {
  return localizedPluginDetail(plugin);
}

export function ArtifactPluginDetail(props: ArtifactPluginDetailProps) {
  const { plugin, labels } = props;
  const primarySkillId =
    plugin.skills.find((skill) => skill.id === plugin.id)?.id ??
    plugin.skills[0]?.id;
  const copy = localizedPluginDetail(plugin);

  return (
    // Surface chrome comes from the parent dialog; keep body padding-free for scroll layout.
    <article className="space-y-6">
      {/* Clean header: icon + title + status badge. Enable/disable stays on the market card. */}
      <header className="flex min-w-0 items-start gap-3.5">
        <ArtifactPluginIcon pluginId={plugin.id} />
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold leading-7 text-dls-text">
              {copy.title}
            </h2>
            {plugin.enabled ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                aria-hidden
              />
            ) : null}
            <StatusBadge
              tone={plugin.enabled ? "success" : "neutral"}
              shape="soft"
              size="tiny"
            >
              {plugin.enabled ? labels.enabled : labels.disabled}
            </StatusBadge>
          </div>
          <p className="max-w-xl text-sm leading-6 text-dls-secondary">
            {copy.longDescription}
          </p>
          {plugin.id === "browser" ? (
            <p className="text-xs font-medium text-dls-secondary">
              {t("plugins.artifact_plugin_browser_system")}
            </p>
          ) : null}
        </div>
      </header>

      {primarySkillId && copy.prompts.length > 0 ? (
        <TryThisPromptsSection title={labels.starterPrompts}>
          <ArtifactStarterPrompts
            pluginId={plugin.id}
            skillId={primarySkillId}
            prompts={copy.prompts}
            onSelectPrompt={props.onSelectPrompt}
            disabled={props.starterPromptsDisabled || !plugin.enabled}
          />
        </TryThisPromptsSection>
      ) : null}
    </article>
  );
}
