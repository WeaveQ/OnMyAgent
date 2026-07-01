/** @jsxImportSource react */
import { Cpu } from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { CodeToken } from "@/components/ui/code-token";
import { StatusBadge } from "@/components/ui/status-badge";
import { TextInput } from "../../../design-system/text-input";
import { SettingsListEmptyState } from "../settings-list";
import { SettingsActionRow, SettingsCard, SettingsPanel } from "../settings-section";

// Explicit, prop-driven shape of the extensions store. The Solid
// PluginsView pulled this from useExtensions(); in React we pass it
// in so the page stays stateless and the extensions provider can be
// ported separately.
export type PluginsExtensionsStore = {
  pluginScope: "project" | "global";
  setPluginScope: (value: "project" | "global") => void;
  refreshPlugins: (scope?: "project" | "global") => void | Promise<void>;
  pluginConfigPath: () => string | null;
  pluginConfig: () => { path?: string | null } | null;
  pluginList: () => Array<{
    name: string;
    source: "config" | "dir.project" | "dir.global";
    removable: boolean;
  }>;
  pluginInput: () => string;
  setPluginInput: (value: string) => void;
  pluginStatus: () => string | null;
  addPlugin: (packageName?: string) => void | Promise<void>;
  removePlugin: (packageName: string) => void | Promise<void>;
  isPluginInstalledByName: (packageName: string, aliases?: string[]) => boolean;
  activePluginGuide: () => string | null;
  setActivePluginGuide: (packageName: string | null) => void;
};

type SuggestedPlugin = {
  name: string;
  packageName: string;
  description: string;
  tags: string[];
  aliases?: string[];
  installMode?: "simple" | "guided";
  steps?: Array<{
    title: string;
    description: string;
    command?: string;
    url?: string;
    path?: string;
    note?: string;
  }>;
};

export type PluginsViewProps = {
  extensions: PluginsExtensionsStore;
  busy: boolean;
  selectedWorkspaceRoot: string;
  canEditPlugins: boolean;
  canUseGlobalScope: boolean;
  accessHint?: string | null;
  suggestedPlugins: SuggestedPlugin[];
};

export function PluginsView(props: PluginsViewProps) {
  const { extensions } = props;
  const scope = extensions.pluginScope;
  return (
    <section className="space-y-6 max-w-3xl w-full">
      <SettingsCard className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-sm font-medium text-dls-text">
              {t("plugins.title")}
            </div>
            <div className="text-xs text-dls-secondary">{t("plugins.desc")}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={scope === "project" ? "secondary" : "outline"}
              size="xs"
              onClick={() => {
                extensions.setPluginScope("project");
                void extensions.refreshPlugins("project");
              }}
            >
              {t("plugins.scope_project")}
            </Button>
            <Button
              variant={scope === "global" ? "secondary" : "outline"}
              size="xs"
              disabled={!props.canUseGlobalScope}
              onClick={() => {
                if (!props.canUseGlobalScope) return;
                extensions.setPluginScope("global");
                void extensions.refreshPlugins("global");
              }}
            >
              {t("plugins.scope_global")}
            </Button>
            <Button
              variant="outline"
              onClick={() => void extensions.refreshPlugins()}
            >
              {t("common.refresh")}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1 text-xs text-dls-secondary">
          <div>{t("plugins.config_label")}</div>
          <div className="text-dls-secondary font-mono truncate">
            {extensions.pluginConfigPath() ??
              extensions.pluginConfig()?.path ??
              t("plugins.not_loaded_yet")}
          </div>
          {props.accessHint ? (
            <div className="text-dls-secondary">{props.accessHint}</div>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="text-xs font-medium text-dls-secondary">
            {t("plugins.suggested_heading")}
          </div>
          <div className="grid gap-3">
            {props.suggestedPlugins.map((plugin) => {
              const isGuided = plugin.installMode === "guided";
              const isInstalled = extensions.isPluginInstalledByName(
                plugin.packageName,
                plugin.aliases ?? [],
              );
              const isGuideOpen =
                extensions.activePluginGuide() === plugin.packageName;

              return (
                <SettingsCard key={plugin.packageName} className="space-y-3" size="compact" tone="surface">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-dls-text font-mono">
                        {plugin.name}
                      </div>
                      <div className="text-xs text-dls-secondary mt-1">
                        {plugin.description}
                      </div>
                      {plugin.packageName !== plugin.name ? (
                        <div className="text-xs text-dls-secondary font-mono mt-1">
                          {plugin.packageName}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {isGuided ? (
                        <Button
                          variant="outline"
                          onClick={() =>
                            extensions.setActivePluginGuide(
                              isGuideOpen ? null : plugin.packageName,
                            )
                          }
                        >
                          {isGuideOpen
                            ? t("plugins.hide_setup")
                            : t("plugins.setup")}
                        </Button>
                      ) : null}
                      <Button
                        variant={isInstalled ? "outline" : "default"}
                        onClick={() => extensions.addPlugin(plugin.packageName)}
                        disabled={
                          props.busy ||
                          isInstalled ||
                          !props.canEditPlugins ||
                          (scope === "project" &&
                            !props.selectedWorkspaceRoot.trim())
                        }
                      >
                        {isInstalled ? t("plugins.added") : t("plugins.add")}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {plugin.tags.map((tag) => (
                      <StatusBadge key={tag} size="tiny">
                        {tag}
                      </StatusBadge>
                    ))}
                  </div>
                  {isGuided && isGuideOpen ? (
                    <SettingsPanel className="space-y-3" tone="soft">
                      {(plugin.steps ?? []).map((step, idx) => (
                        <div
                          key={`${plugin.packageName}:step:${step.title}:${step.command ?? step.url ?? step.path ?? step.description}`}
                          className="space-y-1"
                        >
                          <div className="text-xs font-medium text-dls-secondary">
                            {idx + 1}. {step.title}
                          </div>
                          <div className="text-xs text-dls-secondary">
                            {step.description}
                          </div>
                          {step.command ? (
                            <CodeToken tone="surface" size="lg" display="block" className="border-dls-border/70 bg-dls-surface-muted/60 text-dls-text">
                              {step.command}
                            </CodeToken>
                          ) : null}
                          {step.note ? (
                            <div className="text-xs text-dls-secondary">
                              {step.note}
                            </div>
                          ) : null}
                          {step.url ? (
                            <div className="text-xs text-dls-secondary">
                              Open:{" "}
                              <span className="font-mono text-dls-secondary">
                                {step.url}
                              </span>
                            </div>
                          ) : null}
                          {step.path ? (
                            <div className="text-xs text-dls-secondary">
                              Path:{" "}
                              <span className="font-mono text-dls-secondary">
                                {step.path}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </SettingsPanel>
                  ) : null}
                </SettingsCard>
              );
            })}
          </div>
        </div>

        {extensions.pluginList().length === 0 ? (
          <SettingsListEmptyState>
            {t("plugins.empty")}
          </SettingsListEmptyState>
        ) : (
          <div className="grid gap-2">
            {extensions.pluginList().map((plugin) => (
              <SettingsActionRow key={plugin.name} density="compact">
                <div>
                  <div className="text-sm text-dls-text font-mono flex items-center gap-2">
                    <Cpu size={14} className="text-dls-secondary" />
                    {plugin.name}
                  </div>
                  {!plugin.removable ? (
                    <div className="mt-1 text-xs text-dls-secondary">
                      {plugin.source === "dir.global"
                        ? "Discovered from a global plugin folder."
                        : "Discovered from the workspace plugin folder."}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge size="tiny">
                    {plugin.removable ? t("plugins.enabled") : t("settings.cap_read_only")}
                  </StatusBadge>
                  {plugin.removable ? (
                    <Button
                      variant="destructive"
                      size="xs"
                      onClick={() => extensions.removePlugin(plugin.name)}
                      disabled={props.busy || !props.canEditPlugins}
                    >
                      {t("plugins.remove")}
                    </Button>
                  ) : null}
                </div>
              </SettingsActionRow>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1">
              <TextInput
                label={t("plugins.add_label")}
                placeholder="opencode-wakatime"
                value={extensions.pluginInput()}
                onChange={(event) =>
                  extensions.setPluginInput(event.currentTarget.value)
                }
                hint={t("plugins.add_hint")}
              />
            </div>
            <Button
              onClick={() => extensions.addPlugin()}
              disabled={
                props.busy ||
                !extensions.pluginInput().trim() ||
                !props.canEditPlugins
              }
              className="md:mt-6"
            >
              {t("plugins.add")}
            </Button>
          </div>
          {extensions.pluginStatus() ? (
            <div className="text-xs text-dls-secondary">
              {extensions.pluginStatus()}
            </div>
          ) : null}
        </div>
      </SettingsCard>
    </section>
  );
}
