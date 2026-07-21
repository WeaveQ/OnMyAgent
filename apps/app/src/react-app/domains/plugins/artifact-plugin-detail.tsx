/** @jsxImportSource react */
import type { ComponentType } from "react";
import {
  AppWindow,
  FileSpreadsheet,
  FileText,
  FileType,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
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
  onPluginEnabledChange: (enabled: boolean) => Promise<void>;
  onSkillEnabledChange: (skillId: string, enabled: boolean) => Promise<void>;
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
 * Solid brand-color tiles (white glyph) so they sit with connector logos below
 * instead of washed monochrome accent chips.
 */
const PLUGIN_ICON_META: Record<
  string,
  {
    Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true"; strokeWidth?: number }>;
    tile: string;
  }
> = {
  browser: {
    Icon: AppWindow,
    // Chromium-ish sky
    tile: "bg-[#4285F4] text-white shadow-sm shadow-sky-500/25",
  },
  documents: {
    Icon: FileText,
    // Word blue
    tile: "bg-[#2B579A] text-white shadow-sm shadow-blue-900/20",
  },
  pdf: {
    Icon: FileType,
    // Adobe-ish red
    tile: "bg-[#E5252A] text-white shadow-sm shadow-red-600/25",
  },
  spreadsheets: {
    Icon: FileSpreadsheet,
    // Excel green
    tile: "bg-[#217346] text-white shadow-sm shadow-emerald-900/20",
  },
};

const DEFAULT_PLUGIN_ICON = {
  Icon: FileText,
  tile: "bg-dls-text text-dls-background",
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
  const meta = PLUGIN_ICON_META[pluginId] ?? DEFAULT_PLUGIN_ICON;
  const { Icon } = meta;
  const box = size === "sm" ? "size-9 rounded-xl" : "size-11 rounded-2xl";
  const iconSize = size === "sm" ? "size-4" : "size-5";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        box,
        meta.tile,
        className,
      )}
      aria-hidden="true"
    >
      <Icon className={cn(iconSize, "text-white")} strokeWidth={2} />
    </span>
  );
}

export function ArtifactStarterPrompts(props: ArtifactStarterPromptsProps) {
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
      {props.prompts.map((prompt) => (
        <Button
          key={prompt}
          type="button"
          variant="outline"
          className="h-auto min-h-10 justify-start whitespace-normal py-2 text-left"
          data-artifact-prompt={prompt}
          disabled={props.disabled}
          onClick={() => props.onSelectPrompt(props.pluginId, props.skillId, prompt)}
        >
          {prompt}
        </Button>
      ))}
    </div>
  );
}

export function ArtifactPluginDetail(props: ArtifactPluginDetailProps) {
  const { plugin, labels } = props;
  const primarySkillId = plugin.skills.find((skill) => skill.id === plugin.id)?.id
    ?? plugin.skills[0]?.id;
  const connectionUnavailable = plugin.connection?.status === "unavailable";

  const title =
    plugin.id === "browser"
      ? t("plugins.artifact_plugin_browser_name")
      : plugin.manifest.interface.displayName;

  return (
    // Surface chrome comes from the parent dialog; keep body padding-free for scroll layout.
    <article className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ArtifactPluginIcon pluginId={plugin.id} />
          <div className="min-w-0">
            <h2 className="text-lg font-medium leading-7 text-dls-text">{title}</h2>
            <p className="mt-1 text-sm text-dls-secondary">
              {plugin.manifest.interface.longDescription}
            </p>
            {plugin.id === "browser" ? (
              <p className="mt-2 text-xs font-medium text-dls-secondary">
                {t("plugins.artifact_plugin_browser_system")}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge tone={plugin.enabled ? "success" : "neutral"} shape="soft" size="tiny">
            {plugin.enabled ? labels.enabled : labels.disabled}
          </StatusBadge>
          <Switch
            checked={plugin.enabled}
            aria-label={labels.pluginEnabled}
            onCheckedChange={(enabled) => void props.onPluginEnabledChange(enabled)}
          />
        </div>
      </header>

      {primarySkillId ? (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-dls-text">{labels.starterPrompts}</h3>
          <ArtifactStarterPrompts
            pluginId={plugin.id}
            skillId={primarySkillId}
            prompts={plugin.manifest.interface.defaultPrompt}
            onSelectPrompt={props.onSelectPrompt}
            disabled={props.starterPromptsDisabled}
          />
        </section>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-dls-text">{labels.skills}</h3>
        <div className="divide-y divide-dls-border rounded-lg border border-dls-border">
          {plugin.skills.map((skill) => {
            const unavailable = connectionUnavailable && skill.id === "excel-live-control";
            const disabled = !plugin.enabled || unavailable;
            return (
              <div key={skill.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-dls-text">{skill.id}</div>
                  {unavailable ? (
                    <p className="mt-1 text-xs text-dls-secondary">{labels.unavailable}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge tone={skill.enabled && !disabled ? "success" : "neutral"} shape="soft" size="tiny">
                    {skill.enabled && !disabled ? labels.enabled : labels.disabled}
                  </StatusBadge>
                  <Switch
                    checked={skill.enabled && !disabled}
                    disabled={disabled}
                    aria-label={labels.skillEnabled(skill.id)}
                    onCheckedChange={(enabled) => void props.onSkillEnabledChange(skill.id, enabled)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </article>
  );
}
