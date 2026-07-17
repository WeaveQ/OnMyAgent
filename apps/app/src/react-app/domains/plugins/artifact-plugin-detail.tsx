/** @jsxImportSource react */
import { FileText, FileType2, Globe2, Sheet } from "lucide-react";

import { IconTile } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";

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

function pluginIcon(pluginId: string) {
  if (pluginId === "browser") return Globe2;
  if (pluginId === "pdf") return FileType2;
  if (pluginId === "spreadsheets") return Sheet;
  return FileText;
}

export function ArtifactPluginIcon({
  pluginId,
  size = "md",
}: {
  pluginId: string;
  size?: "sm" | "md";
}) {
  const Icon = pluginIcon(pluginId);
  return (
    <IconTile
      size={size === "sm" ? "sm" : "md"}
      tone="accent"
      shape={size === "sm" ? "lg" : "xl"}
      className="shrink-0"
    >
      <Icon className={size === "sm" ? "size-4" : "size-5"} aria-hidden="true" />
    </IconTile>
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

  return (
    <article className="space-y-8 rounded-xl border border-dls-border bg-dls-surface p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <ArtifactPluginIcon pluginId={plugin.id} />
          <div className="min-w-0">
            <h2 className="text-lg font-medium leading-7 text-dls-text">
              {plugin.id === "browser"
                ? t("plugins.artifact_plugin_browser_name")
                : plugin.manifest.interface.displayName}
            </h2>
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
          <h3 className="text-base font-medium text-dls-text">{labels.starterPrompts}</h3>
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
        <h3 className="text-base font-medium text-dls-text">{labels.skills}</h3>
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
