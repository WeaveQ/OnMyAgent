/** @jsxImportSource react */
import type { AgentRuntimeHealth, AgentRuntimeKind } from "@onmyagent/types/agent-runtime";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { SelectMenu } from "../../design-system/select-menu";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsPageSection,
} from "../../domains/settings/settings-section";
import { useAgentRuntimeController } from "./controller";
import { grokCommandCatalogUsable } from "./grok-feature-states";

const kinds: readonly AgentRuntimeKind[] = ["opencode", "grok-build"];

export function AgentRuntimeSettingsSection(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
}) {
  const { query, catalogQuery, connectorToolsQuery, mutation, authenticationMutation, grokFeatureStates } =
    useAgentRuntimeController(props);
  const grokCommandsUsable = grokCommandCatalogUsable(grokFeatureStates);
  const snapshot = query.data;
  const config = snapshot?.config;
  const currentDefault = config?.defaultRuntimeKind ?? "opencode";
  const currentWorkspace = config?.workspaceOverrides[props.workspaceId] ?? null;
  const currentGrokProfile = config?.grokBuild?.profileId === "managed"
    || config?.grokBuild?.homeMode === "managed"
    ? "managed"
    : "system";
  const currentGrokBinary = config?.grokBuild?.binaryMode === "bundled"
    ? "bundled"
    : "system";
  const defaultKinds = optionKinds(
    snapshot?.selectableDefaultRuntimeKinds ?? [],
    currentDefault,
  );
  const workspaceKinds = optionKinds(
    snapshot?.selectableWorkspaceRuntimeKinds ?? [],
    currentWorkspace,
  );
  const busy = query.isFetching || mutation.isPending || !config;

  return (
    <SettingsPageSection
      title={t("settings.agent_runtime_title")}
      description={t("settings.agent_runtime_description")}
    >
      <SettingsBlock>
        <SettingsBlockRow
          title={t("settings.agent_runtime_default")}
          description={t("settings.agent_runtime_default_description")}
          actions={
            <div className="w-[11rem]">
              <SelectMenu
                ariaLabel={t("settings.agent_runtime_default")}
                disabled={busy}
                value={currentDefault}
                options={defaultKinds.map(runtimeOption)}
                onChange={(value) => mutation.mutate({
                  type: "default",
                  runtimeKind: runtimeKind(value),
                })}
              />
            </div>
          }
        />
        {snapshot?.availableRuntimeKinds.includes("grok-build") ? (
          <div data-grok-command-catalog={grokCommandsUsable ? "usable" : "blocked"}>
            <SettingsBlockRow
              title={t("settings.agent_runtime_grok_profile")}
              description={currentGrokProfile === "system"
                ? t("settings.agent_runtime_grok_profile_system_description")
                : t("settings.agent_runtime_grok_profile_managed_description")}
              actions={
                <div className="w-[11rem]">
                  <SelectMenu
                    ariaLabel={t("settings.agent_runtime_grok_profile")}
                    disabled={busy}
                    value={currentGrokProfile}
                    options={[
                      { value: "system", label: t("settings.agent_runtime_grok_profile_system") },
                      { value: "managed", label: t("settings.agent_runtime_grok_profile_managed") },
                    ]}
                    onChange={(value) => mutation.mutate({
                      type: "grok-profile",
                      homeMode: value === "managed" ? "managed" : "system",
                    })}
                  />
                </div>
              }
            />
            <SettingsBlockRow
              title={t("settings.agent_runtime_grok_binary")}
              description={currentGrokBinary === "bundled"
                ? t("settings.agent_runtime_grok_binary_bundled_description")
                : t("settings.agent_runtime_grok_binary_system_description")}
              actions={
                <div className="w-[11rem]">
                  <SelectMenu
                    ariaLabel={t("settings.agent_runtime_grok_binary")}
                    disabled={busy}
                    value={currentGrokBinary}
                    options={[
                      { value: "system", label: t("settings.agent_runtime_grok_binary_system") },
                      { value: "bundled", label: t("settings.agent_runtime_grok_binary_bundled") },
                    ]}
                    onChange={(value) => mutation.mutate({
                      type: "grok-binary",
                      binaryMode: value === "bundled" ? "bundled" : "system",
                    })}
                  />
                </div>
              }
            />
          </div>
        ) : null}
        <SettingsBlockRow
          title={t("settings.agent_runtime_workspace")}
          description={t("settings.agent_runtime_workspace_description")}
          actions={
            <div className="w-[11rem]">
              <SelectMenu
                ariaLabel={t("settings.agent_runtime_workspace")}
                disabled={busy || !props.workspaceId}
                value={currentWorkspace ?? "inherit"}
                options={[
                  { value: "inherit", label: t("settings.agent_runtime_inherit") },
                  ...workspaceKinds.map(runtimeOption),
                ]}
                onChange={(value) => mutation.mutate({
                  type: "workspace",
                  runtimeKind: value === "inherit" ? null : runtimeKind(value),
                })}
              />
            </div>
          }
        />
        {snapshot?.health.map((item) => (
          <SettingsBlockRow
            key={item.health.runtimeKind}
            title={runtimeLabel(item.health.runtimeKind)}
            description={item.capabilities?.nativeVersion
              ? t("settings.agent_runtime_version", { version: item.capabilities.nativeVersion })
              : t("settings.agent_runtime_version_unknown")}
            actions={
              <StatusBadge tone={healthTone(item.health.health)} shape="soft">
                {healthLabel(item.health.health)}
              </StatusBadge>
            }
          />
        ))}
        {snapshot?.rollout ? (
          <SettingsBlockRow
            title={t("settings.agent_runtime_rollout_sessions")}
            description={t("settings.agent_runtime_rollout_sessions_description", {
              counts: snapshot.rollout.runtimeCounts
                .map((item) => `${runtimeLabel(item.runtimeKind)}: ${item.count}`)
                .join(" · ") || "0",
            })}
            actions={
              <StatusBadge tone={snapshot.rollout.complete ? "neutral" : "warning"} shape="soft">
                {snapshot.rollout.sessionCount}
              </StatusBadge>
            }
          />
        ) : null}
      </SettingsBlock>
      {catalogQuery.data ? (
        <SettingsBlock>
          <SettingsBlockRow
            title={t("settings.agent_runtime_active_catalog")}
            description={t("settings.agent_runtime_active_catalog_description", {
              runtime: runtimeLabel(catalogQuery.data.runtimeKind),
              profile: catalogQuery.data.profileId,
            })}
            actions={
              <StatusBadge
                tone={catalogQuery.data.auth.state === "ready" ? "success" : "warning"}
                shape="soft"
              >
                {catalogQuery.data.auth.state === "ready"
                  ? t("settings.agent_runtime_auth_ready")
                  : catalogQuery.data.auth.state === "needs_auth"
                    ? t("settings.agent_runtime_auth_needed")
                    : t("settings.agent_runtime_auth_unknown")}
              </StatusBadge>
            }
          />
          <SettingsBlockRow
            title={t("settings.agent_runtime_default_model")}
            description={catalogQuery.data.defaultModelRef?.modelId
              ?? t("settings.agent_runtime_model_unknown")}
            actions={
              <StatusBadge tone="neutral" shape="soft">
                {t("settings.agent_runtime_model_count", {
                  count: catalogQuery.data.models.length,
                })}
              </StatusBadge>
            }
          />
          {catalogQuery.data.auth.state === "needs_auth"
            && catalogQuery.data.auth.methods[0] ? (
              <SettingsBlockRow
                title={t("settings.agent_runtime_auth_action")}
                description={t("settings.agent_runtime_auth_action_description")}
                actions={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={authenticationMutation.isPending}
                    onClick={() => authenticationMutation.mutate(
                      catalogQuery.data!.auth.methods[0]!.id,
                    )}
                  >
                    {authenticationMutation.isPending
                      ? t("settings.agent_runtime_auth_in_progress")
                      : catalogQuery.data.auth.methods[0].label
                        ?? t("settings.agent_runtime_auth_start")}
                  </Button>
                }
              />
            ) : null}
        </SettingsBlock>
      ) : null}
      {connectorToolsQuery.data ? (
        <SettingsBlock>
          {connectorToolsQuery.data.items.map((item) => (
            <SettingsBlockRow
              key={item.connectorId}
              title={connectorLabel(item.connectorId)}
              description={item.accountConnected
                ? item.toolAvailable
                  ? t("settings.agent_runtime_connector_available_description", {
                      runtime: runtimeLabel(connectorToolsQuery.data.runtimeKind),
                    })
                  : t("settings.agent_runtime_connector_projection_unavailable")
                : t("settings.agent_runtime_connector_account_disconnected")}
              actions={
                <StatusBadge
                  tone={item.toolAvailable ? "success" : item.accountConnected ? "warning" : "neutral"}
                  shape="soft"
                >
                  {item.toolAvailable
                    ? t("settings.agent_runtime_connector_available")
                    : item.accountConnected
                      ? t("settings.agent_runtime_connector_unavailable")
                      : t("settings.agent_runtime_connector_disconnected")}
                </StatusBadge>
              }
            />
          ))}
        </SettingsBlock>
      ) : null}
      {snapshot?.availableRuntimeKinds.includes("grok-build")
        && !snapshot.selectableWorkspaceRuntimeKinds?.includes("grok-build") ? (
          <NoticeBox tone="warning" size="content">
            {t("settings.agent_runtime_grok_rollout_disabled")}
          </NoticeBox>
        ) : null}
      {query.isError || catalogQuery.isError || connectorToolsQuery.isError || mutation.isError
        || authenticationMutation.isError ? (
        <NoticeBox tone="error" size="content">
          {t("settings.agent_runtime_update_failed")}
        </NoticeBox>
      ) : null}
    </SettingsPageSection>
  );
}

function connectorLabel(connectorId: string): string {
  if (connectorId === "tencent-docs") return "Tencent Docs";
  if (connectorId === "baidu-drive") return "Baidu Drive";
  if (connectorId === "kdocs") return "Kingsoft Docs";
  if (connectorId === "dingtalk") return "DingTalk";
  return "Tencent Meeting";
}

function optionKinds(
  selectable: readonly AgentRuntimeKind[],
  current: AgentRuntimeKind | null,
): AgentRuntimeKind[] {
  return kinds.filter((kind) => selectable.includes(kind) || kind === current);
}

function runtimeOption(kind: AgentRuntimeKind) {
  return { value: kind, label: runtimeLabel(kind) };
}

function runtimeKind(value: string): AgentRuntimeKind {
  return value === "grok-build" ? "grok-build" : "opencode";
}

function runtimeLabel(kind: AgentRuntimeKind): string {
  return kind === "grok-build" ? "Grok Build" : "OpenCode";
}

function healthTone(health: string): "success" | "warning" | "danger" | "neutral" {
  if (health === "ready") return "success";
  if (health === "needs_auth" || health === "degraded") return "warning";
  if (health === "crashed" || health === "missing") return "danger";
  return "neutral";
}

function healthLabel(health: AgentRuntimeHealth): string {
  switch (health) {
    case "missing":
      return t("settings.agent_runtime_health_missing");
    case "process_ready":
      return t("settings.agent_runtime_health_process_ready");
    case "needs_auth":
      return t("settings.agent_runtime_health_needs_auth");
    case "ready":
      return t("settings.agent_runtime_health_ready");
    case "degraded":
      return t("settings.agent_runtime_health_degraded");
    case "crashed":
      return t("settings.agent_runtime_health_crashed");
  }
}
