import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";

import { desktopBridge } from "../../../app/lib/desktop";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { NoticeBox } from "@/components/ui/notice-box";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { registerExtensionConfig } from "../shared";
import { SettingsActionRow } from "./settings-section";
import { t } from "@/i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PermissionResult = {
  ok: boolean;
  accessibility: boolean;
  screenRecording: boolean;
  error?: string;
  helperVersion?: string;
  desktopVersion?: string;
  protocolVersion?: number;
  activity?: {
    phase?: "inactive" | "ready" | "running" | "paused" | "errored";
    app?: string;
    reason?: string;
  };
  skysight?: {
    enabled: boolean;
    paused?: boolean;
    retentionDays?: number;
    recording?: boolean;
    exclusions?: Array<{
      scope: "app" | "website" | "private_browsing";
      value?: string;
    }>;
  };
  appAuthorizations?: {
    version: number;
    allowedBundleIdentifiers: string[];
  };
};

type ComputerUseConfigProps = {
  connected: boolean;
  connecting: boolean;
  onConnect?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
};

/** Real setup steps 1–5 (MCP → permissions → runtime → app access → memory). */
type SetupStepId = 1 | 2 | 3 | 4 | 5;

const SETUP_STEPS: readonly SetupStepId[] = [1, 2, 3, 4, 5];

const computerUseLayoutClass = {
  content: "flex min-h-0 flex-col gap-5",
  // Full-width equal steps so 1–5 stay stable (overrides SegmentedTabGroup w-fit).
  stepTabs: "flex w-full min-w-0",
  // Fixed body height so switching 1–5 does not resize the modal.
  stepPanel:
    "h-[min(28rem,46vh)] min-h-[22rem] space-y-4 overflow-y-auto overscroll-contain pr-0.5",
  stepTab: "min-w-0 flex-1 justify-center tabular-nums",
  actionButton: "min-h-10 w-full whitespace-normal text-center lg:w-auto",
  primaryActionButton: "min-h-10 w-full justify-center whitespace-normal text-center",
  buttonLabel: "min-w-0 break-words",
  permissionsStack: "flex w-full min-w-0 flex-col gap-3",
  permissionGrid: "grid gap-2",
  runtimeGrid: "grid gap-2 xl:grid-cols-2",
  footer: "flex w-full flex-col gap-3 xl:flex-row xl:items-center xl:justify-between",
  footerActions: "flex w-full flex-col gap-2 xl:w-auto xl:flex-row",
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerExtensionConfig("computer-use", (ctx) => (
  <ComputerUseConfig
    connected={ctx.computerUse?.connected ?? false}
    connecting={ctx.computerUse?.connecting ?? false}
    onConnect={ctx.computerUse?.onConnect}
    onRefresh={ctx.computerUse?.onRefresh}
  />
));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasDesktopBridge() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.__ONMYAGENT_ELECTRON__?.invokeDesktop)
  );
}

function normalizeSkysightExclusions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || !("scope" in entry)) {
      return [];
    }
    const scope = entry.scope;
    if (scope !== "app" && scope !== "website" && scope !== "private_browsing") {
      return [];
    }
    const item: {
      scope: "app" | "website" | "private_browsing";
      value?: string;
    } = { scope };
    if ("value" in entry && typeof entry.value === "string") {
      item.value = entry.value;
    }
    return [item];
  });
}

function normalize(value: unknown): PermissionResult {
  if (typeof value !== "object" || value === null) {
    return {
      ok: false,
      accessibility: false,
      screenRecording: false,
      error: t("settings.unreadable_response"),
    };
  }
  return {
    ok: "ok" in value && value.ok === true,
    accessibility: "accessibility" in value && value.accessibility === true,
    screenRecording:
      "screenRecording" in value && value.screenRecording === true,
    error:
      "error" in value && typeof value.error === "string"
        ? value.error
        : undefined,
    helperVersion:
      "helperVersion" in value && typeof value.helperVersion === "string"
        ? value.helperVersion
        : undefined,
    desktopVersion:
      "desktopVersion" in value && typeof value.desktopVersion === "string"
        ? value.desktopVersion
        : undefined,
    protocolVersion:
      "protocolVersion" in value && typeof value.protocolVersion === "number"
        ? value.protocolVersion
        : undefined,
    activity:
      "activity" in value && typeof value.activity === "object" && value.activity !== null
        ? {
            phase:
              "phase" in value.activity &&
              (value.activity.phase === "inactive" ||
                value.activity.phase === "ready" ||
                value.activity.phase === "running" ||
                value.activity.phase === "paused" ||
                value.activity.phase === "errored")
                ? value.activity.phase
                : undefined,
            app:
              "app" in value.activity && typeof value.activity.app === "string"
                ? value.activity.app
                : undefined,
            reason:
              "reason" in value.activity && typeof value.activity.reason === "string"
                ? value.activity.reason
                : undefined,
          }
        : undefined,
    skysight:
      "skysight" in value &&
      typeof value.skysight === "object" &&
      value.skysight !== null &&
      "enabled" in value.skysight &&
      typeof value.skysight.enabled === "boolean"
        ? {
            enabled: value.skysight.enabled,
            paused:
              "paused" in value.skysight &&
              typeof value.skysight.paused === "boolean"
                ? value.skysight.paused
                : undefined,
            retentionDays:
              "retentionDays" in value.skysight &&
              typeof value.skysight.retentionDays === "number"
                ? value.skysight.retentionDays
                : undefined,
            recording:
              "recording" in value.skysight &&
              typeof value.skysight.recording === "boolean"
                ? value.skysight.recording
                : undefined,
            exclusions:
              "exclusions" in value.skysight
                ? normalizeSkysightExclusions(value.skysight.exclusions)
                : [],
          }
        : undefined,
    appAuthorizations:
      "appAuthorizations" in value &&
      typeof value.appAuthorizations === "object" &&
      value.appAuthorizations !== null &&
      "allowedBundleIdentifiers" in value.appAuthorizations &&
      Array.isArray(value.appAuthorizations.allowedBundleIdentifiers) &&
      value.appAuthorizations.allowedBundleIdentifiers.every(
        (identifier) => typeof identifier === "string",
      )
        ? {
            version:
              "version" in value.appAuthorizations &&
              typeof value.appAuthorizations.version === "number"
                ? value.appAuthorizations.version
                : 1,
            allowedBundleIdentifiers:
              value.appAuthorizations.allowedBundleIdentifiers,
          }
        : undefined,
  };
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ComputerUseConfig(props: ComputerUseConfigProps) {
  const [result, setResult] = useState<PermissionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [skysightBusy, setSkysightBusy] = useState(false);
  const [skysightExclusionScope, setSkysightExclusionScope] = useState<
    "app" | "website"
  >("app");
  const [skysightExclusionValue, setSkysightExclusionValue] = useState("");
  const [clearSkysightOpen, setClearSkysightOpen] = useState(false);
  const [authorizationBusy, setAuthorizationBusy] = useState(false);
  const [clearAuthorizationsOpen, setClearAuthorizationsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<SetupStepId>(1);

  // Spawn --check → fresh TCC read. Works whether or not the GUI is open.
  const verify = useCallback(async () => {
    if (!hasDesktopBridge()) {
      setError(
        t("settings.computer_use_desktop_required"),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const raw = await desktopBridge.checkComputerUsePermissions();
      const next = normalize(raw);
      setResult(next);
      if (next.error) setError(next.error);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // Check on mount.
  useEffect(() => {
    void verify();
  }, [verify]);

  // Open the setup GUI then immediately re-verify.
  const grant = async () => {
    if (!hasDesktopBridge()) {
      setError(t("settings.computer_use_desktop_required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const raw = await desktopBridge.openComputerUsePermissionSetup();
      const next = normalize(raw);
      setResult(next);
      if (next.error) setError(next.error);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const allGranted =
    result?.accessibility === true && result.screenRecording === true;
  const versionMismatch =
    result?.helperVersion !== undefined &&
    result.desktopVersion !== undefined &&
    result.helperVersion !== result.desktopVersion;
  const protocolMismatch =
    result?.protocolVersion !== undefined && result.protocolVersion !== 1;

  const setSkysightEnabled = async (enabled: boolean) => {
    if (!hasDesktopBridge()) {
      setError(t("settings.computer_use_desktop_required"));
      return;
    }
    setSkysightBusy(true);
    setError(null);
    try {
      const raw = await desktopBridge.setComputerUseSkysightEnabled(enabled);
      const next = normalize(raw);
      setResult(next);
      if (next.error) setError(next.error);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSkysightBusy(false);
    }
  };

  const clearSkysightData = async () => {
    setSkysightBusy(true);
    setError(null);
    try {
      await desktopBridge.clearComputerUseSkysightData();
      setClearSkysightOpen(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSkysightBusy(false);
    }
  };

  const setSkysightPaused = async (paused: boolean) => {
    setSkysightBusy(true);
    setError(null);
    try {
      const raw = await desktopBridge.setComputerUseSkysightPaused(paused);
      const next = normalize(raw);
      setResult(next);
      if (next.error) setError(next.error);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSkysightBusy(false);
    }
  };

  const updateSkysightExclusion = async (
    operation: "add" | "remove",
    scope: "app" | "website" | "private_browsing",
    value?: string,
  ) => {
    setSkysightBusy(true);
    setError(null);
    try {
      const raw = await desktopBridge.updateComputerUseSkysightExclusion(
        operation,
        scope,
        value,
      );
      const next = normalize(raw);
      setResult(next);
      if (next.error) setError(next.error);
      if (operation === "add") setSkysightExclusionValue("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSkysightBusy(false);
    }
  };

  const revokeAppAuthorization = async (bundleIdentifier: string) => {
    setAuthorizationBusy(true);
    setError(null);
    try {
      const raw = await desktopBridge.revokeComputerUseAppAuthorization(
        bundleIdentifier,
      );
      const next = normalize(raw);
      setResult(next);
      if (next.error) setError(next.error);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setAuthorizationBusy(false);
    }
  };

  const clearAppAuthorizations = async () => {
    setAuthorizationBusy(true);
    setError(null);
    try {
      const raw = await desktopBridge.clearComputerUseAppAuthorizations();
      const next = normalize(raw);
      setResult(next);
      if (next.error) setError(next.error);
      setClearAuthorizationsOpen(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setAuthorizationBusy(false);
    }
  };

  const stepComplete: Record<SetupStepId, boolean> = {
    1: props.connected,
    2: allGranted,
    3: result?.protocolVersion === 1 && !versionMismatch && !protocolMismatch,
    4: result?.appAuthorizations !== undefined,
    5: result !== null,
  };
  const stepAriaLabel: Record<SetupStepId, string> = {
    1: t("settings.computer_use_connect_step_title"),
    2: t("settings.computer_use_permissions_step_title"),
    3: t("settings.computer_use_runtime_step_title"),
    4: t("settings.computer_use_app_authorizations_title"),
    5: t("settings.computer_use_skysight_title"),
  };

  return (
    <Card variant="outline" size="sm">
      <CardHeader>
        <CardTitle>{t("settings.computer_use_setup_title")}</CardTitle>
        <CardDescription>
          {t("settings.computer_use_setup_description")}
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void verify()}
            disabled={busy}
            aria-label={t("settings.computer_use_verify_permissions")}
          >
            <RefreshCw className={busy ? "animate-spin" : ""} />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className={computerUseLayoutClass.content}>
        {error ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription className="break-words">{error}</AlertDescription>
          </Alert>
        ) : null}

        <SegmentedTabGroup density="filter" className={computerUseLayoutClass.stepTabs}>
          {SETUP_STEPS.map((stepId) => {
            const complete = stepComplete[stepId];
            const active = step === stepId;
            return (
              <NavTabButton
                key={stepId}
                active={active}
                size="tab"
                shape="tab"
                className={computerUseLayoutClass.stepTab}
                onClick={() => setStep(stepId)}
                aria-label={stepAriaLabel[stepId]}
                title={stepAriaLabel[stepId]}
              >
                <span
                  className={
                    complete
                      ? "text-sm font-medium tabular-nums text-dls-accent"
                      : active
                        ? "text-sm font-medium tabular-nums"
                        : "text-sm tabular-nums text-dls-secondary"
                  }
                >
                  {stepId}
                </span>
              </NavTabButton>
            );
          })}
        </SegmentedTabGroup>

        <div className={computerUseLayoutClass.stepPanel}>
          {step === 1 ? (
            <SetupRow
              title={t("settings.computer_use_connect_step_title")}
              description={t("settings.computer_use_connect_mcp_desc")}
              complete={props.connected}
            >
              <Button
                className={computerUseLayoutClass.actionButton}
                onClick={() => {
                  if (!props.onConnect || props.connected || props.connecting) return;
                  void (async () => {
                    setError(null);
                    try {
                      await props.onConnect?.();
                    } catch (e) {
                      setError(errMsg(e));
                    }
                  })();
                }}
                disabled={!props.onConnect || props.connected || props.connecting}
              >
                {props.connecting ? (
                  <LoadingSpinner size="default" className="shrink-0" />
                ) : null}
                <span className={computerUseLayoutClass.buttonLabel}>
                  {props.connected
                    ? t("settings.computer_use_configured")
                    : props.connecting
                      ? t("settings.computer_use_connecting")
                      : t("extensions.computer_use_connect_mcp")}
                </span>
              </Button>
            </SetupRow>
          ) : null}

          {step === 2 ? (
            <SetupRow
              title={t("settings.computer_use_permissions_step_title")}
              description={t("settings.computer_use_permissions_step_description")}
              complete={allGranted}
            >
              <div className={computerUseLayoutClass.permissionsStack}>
                <div className={computerUseLayoutClass.permissionGrid}>
                  <Pill
                    label={t("settings.permission_accessibility")}
                    granted={result?.accessibility === true}
                    checked={result !== null}
                  />
                  <Pill
                    label={t("settings.permission_screen_recording")}
                    granted={result?.screenRecording === true}
                    checked={result !== null}
                  />
                </div>

                <Button
                  className={computerUseLayoutClass.primaryActionButton}
                  onClick={() => void grant()}
                  disabled={busy}
                >
                  {busy ? (
                    <LoadingSpinner size="default" className="shrink-0" />
                  ) : (
                    <Settings2 className="size-4 shrink-0" />
                  )}
                  <span className={computerUseLayoutClass.buttonLabel}>
                    {busy
                      ? t("settings.computer_use_opening")
                      : allGranted
                        ? t("settings.computer_use_reopen_helper")
                        : t("settings.computer_use_grant_permissions")}
                  </span>
                </Button>
              </div>
            </SetupRow>
          ) : null}

          {step === 3 ? (
            <SetupRow
              title={t("settings.computer_use_runtime_step_title")}
              description={t("settings.computer_use_runtime_step_description")}
              complete={result?.protocolVersion === 1}
            >
              <div className={computerUseLayoutClass.permissionsStack}>
                <div className={computerUseLayoutClass.runtimeGrid}>
                  <StatusValue
                    label={t("settings.computer_use_helper_version")}
                    value={result?.helperVersion ?? t("settings.computer_use_unknown")}
                    tone={result?.helperVersion ? "accent" : "neutral"}
                  />
                  <StatusValue
                    label={t("settings.computer_use_desktop_version")}
                    value={result?.desktopVersion ?? t("settings.computer_use_unknown")}
                    tone={result?.desktopVersion ? "accent" : "neutral"}
                  />
                  <StatusValue
                    label={t("settings.computer_use_protocol")}
                    value={result?.protocolVersion === undefined ? t("settings.computer_use_unknown") : `v${result.protocolVersion}`}
                    tone={result?.protocolVersion === 1 ? "accent" : "warning"}
                  />
                  <StatusValue
                    label={t("settings.computer_use_activity")}
                    value={activityLabel(result?.activity)}
                    tone={result?.activity?.phase === "paused" || result?.activity?.phase === "errored" ? "warning" : result?.activity?.phase === "running" ? "accent" : "neutral"}
                  />
                </div>
                {versionMismatch || protocolMismatch ? (
                  <NoticeBox tone="warning" size="content">
                    {t("settings.computer_use_update_required")}
                  </NoticeBox>
                ) : null}
              </div>
            </SetupRow>
          ) : null}

          {step === 4 ? (
            <SetupRow
              title={t("settings.computer_use_app_authorizations_title")}
              description={t("settings.computer_use_app_authorizations_description")}
              complete={result?.appAuthorizations !== undefined}
            >
              <div className={computerUseLayoutClass.permissionsStack}>
                <NoticeBox tone="info" size="content">
                  {t("settings.computer_use_app_authorizations_notice")}
                </NoticeBox>
                {result?.appAuthorizations?.allowedBundleIdentifiers.length ? (
                  <div className="grid gap-2">
                    {result.appAuthorizations.allowedBundleIdentifiers.map(
                      (bundleIdentifier) => (
                        <SettingsActionRow key={bundleIdentifier} density="compact">
                          <span className="min-w-0 break-all font-mono text-xs">
                            {bundleIdentifier}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={authorizationBusy}
                            aria-label={t("settings.computer_use_app_authorization_revoke")}
                            onClick={() => void revokeAppAuthorization(bundleIdentifier)}
                          >
                            <Trash2 />
                          </Button>
                        </SettingsActionRow>
                      ),
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-dls-secondary">
                    {t("settings.computer_use_app_authorizations_empty")}
                  </div>
                )}
                <Button
                  variant="outline"
                  className={computerUseLayoutClass.actionButton}
                  disabled={
                    authorizationBusy ||
                    !result?.appAuthorizations?.allowedBundleIdentifiers.length
                  }
                  onClick={() => setClearAuthorizationsOpen(true)}
                >
                  {t("settings.computer_use_app_authorizations_clear")}
                </Button>
              </div>
            </SetupRow>
          ) : null}

          {step === 5 ? (
            <SetupRow
              title={t("settings.computer_use_skysight_title")}
              description={t("settings.computer_use_skysight_description")}
              complete={result !== null}
            >
              <div className={computerUseLayoutClass.permissionsStack}>
                <SettingsActionRow density="compact">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {t("settings.computer_use_skysight_toggle")}
                    </div>
                    <div className="mt-1 text-xs text-dls-secondary">
                      {result?.skysight?.recording
                        ? t("settings.computer_use_skysight_recording")
                        : t("settings.computer_use_skysight_stopped")}
                    </div>
                  </div>
                  <Switch
                    aria-label={t("settings.computer_use_skysight_toggle")}
                    checked={result?.skysight?.enabled === true}
                    disabled={result === null || skysightBusy}
                    onCheckedChange={(enabled) => void setSkysightEnabled(enabled)}
                  />
                </SettingsActionRow>
                <SettingsActionRow density="compact">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {t("settings.computer_use_skysight_pause")}
                    </div>
                    <div className="mt-1 text-xs text-dls-secondary">
                      {result?.skysight?.paused
                        ? t("settings.computer_use_skysight_paused")
                        : t("settings.computer_use_skysight_active")}
                    </div>
                  </div>
                  <Switch
                    aria-label={t("settings.computer_use_skysight_pause")}
                    checked={result?.skysight?.paused === true}
                    disabled={result?.skysight?.enabled !== true || skysightBusy}
                    onCheckedChange={(paused) => void setSkysightPaused(paused)}
                  />
                </SettingsActionRow>
                <SettingsActionRow density="compact">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {t("settings.computer_use_skysight_private_browsing")}
                    </div>
                    <div className="mt-1 text-xs text-dls-secondary">
                      {t("settings.computer_use_skysight_private_browsing_description")}
                    </div>
                  </div>
                  <Switch
                    aria-label={t("settings.computer_use_skysight_private_browsing")}
                    checked={!result?.skysight?.exclusions?.some(
                      (entry) => entry.scope === "private_browsing",
                    )}
                    disabled={result === null || skysightBusy}
                    onCheckedChange={(observe) =>
                      void updateSkysightExclusion(
                        observe ? "remove" : "add",
                        "private_browsing",
                      )
                    }
                  />
                </SettingsActionRow>
                <div className="grid gap-2">
                  <div className="text-sm font-medium">
                    {t("settings.computer_use_skysight_exclusions")}
                  </div>
                  <SegmentedTabGroup density="filter">
                    <NavTabButton
                      active={skysightExclusionScope === "app"}
                      size="tab"
                      shape="tab"
                      onClick={() => setSkysightExclusionScope("app")}
                    >
                      {t("settings.computer_use_skysight_exclusion_app")}
                    </NavTabButton>
                    <NavTabButton
                      active={skysightExclusionScope === "website"}
                      size="tab"
                      shape="tab"
                      onClick={() => setSkysightExclusionScope("website")}
                    >
                      {t("settings.computer_use_skysight_exclusion_website")}
                    </NavTabButton>
                  </SegmentedTabGroup>
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                    <Input
                      value={skysightExclusionValue}
                      disabled={skysightBusy}
                      aria-label={t("settings.computer_use_skysight_exclusion_value")}
                      placeholder={t(
                        skysightExclusionScope === "app"
                          ? "settings.computer_use_skysight_exclusion_app_placeholder"
                          : "settings.computer_use_skysight_exclusion_website_placeholder",
                      )}
                      onChange={(event) => setSkysightExclusionValue(event.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={skysightBusy || !skysightExclusionValue.trim()}
                      onClick={() =>
                        void updateSkysightExclusion(
                          "add",
                          skysightExclusionScope,
                          skysightExclusionValue,
                        )
                      }
                    >
                      <Plus />
                      {t("settings.computer_use_skysight_exclusion_add")}
                    </Button>
                  </div>
                  {result?.skysight?.exclusions?.filter(
                    (entry) => entry.scope !== "private_browsing",
                  ).length ? (
                    result.skysight.exclusions
                      .filter((entry) => entry.scope !== "private_browsing")
                      .map((entry) => (
                        <SettingsActionRow
                          key={`${entry.scope}:${entry.value ?? ""}`}
                          density="compact"
                        >
                          <span className="min-w-0 break-all font-mono text-xs">
                            {entry.value}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={skysightBusy}
                            aria-label={t("settings.computer_use_skysight_exclusion_remove")}
                            onClick={() =>
                              void updateSkysightExclusion(
                                "remove",
                                entry.scope,
                                entry.value,
                              )
                            }
                          >
                            <Trash2 />
                          </Button>
                        </SettingsActionRow>
                      ))
                  ) : (
                    <div className="text-xs text-dls-secondary">
                      {t("settings.computer_use_skysight_exclusions_empty")}
                    </div>
                  )}
                </div>
                <NoticeBox tone="info" size="content">
                  {t("settings.computer_use_skysight_privacy")}
                </NoticeBox>
                <Button
                  variant="outline"
                  className={computerUseLayoutClass.actionButton}
                  disabled={skysightBusy}
                  onClick={() => setClearSkysightOpen(true)}
                >
                  {t("settings.computer_use_skysight_clear")}
                </Button>
              </div>
            </SetupRow>
          ) : null}
        </div>
      </CardContent>

      <CardFooter className="border-t border-dls-border">
        <div className={computerUseLayoutClass.footer}>
          <p className="text-xs text-dls-secondary">
            {allGranted
              ? t("settings.computer_use_permissions_verified")
              : t("settings.computer_use_verify_hint")}
          </p>
          <div className={computerUseLayoutClass.footerActions}>
            {props.onRefresh ? (
              <Button
                className="min-h-10 w-full whitespace-normal text-center xl:w-auto"
                variant="outline"
                onClick={() => void props.onRefresh?.()}
              >
                {t("settings.computer_use_refresh_mcp")}
              </Button>
            ) : null}
            <Button
              className="min-h-10 w-full whitespace-normal text-center xl:w-auto"
              onClick={() => void verify()}
              disabled={busy}
            >
              {busy ? (
                <LoadingSpinner size="default" className="shrink-0" />
              ) : null}
              {t("settings.computer_use_verify_permissions")}
            </Button>
          </div>
        </div>
      </CardFooter>
      <AlertDialog open={clearSkysightOpen} onOpenChange={setClearSkysightOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.computer_use_skysight_clear_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.computer_use_skysight_clear_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={skysightBusy}>
              {t("settings.action_cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={skysightBusy}
              onClick={() => void clearSkysightData()}
            >
              {t("settings.computer_use_skysight_clear_confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={clearAuthorizationsOpen}
        onOpenChange={setClearAuthorizationsOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.computer_use_app_authorizations_clear_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.computer_use_app_authorizations_clear_description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={authorizationBusy}>
              {t("settings.action_cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={authorizationBusy}
              onClick={() => void clearAppAuthorizations()}
            >
              {t("settings.computer_use_app_authorizations_clear_confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SetupRow(props: {
  title: string;
  description: string;
  complete: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dls-border bg-dls-surface-muted/60 p-4">
      <div className="flex flex-col gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <StatusIcon complete={props.complete} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-dls-text">
              {props.title}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-dls-secondary">
              {props.description}
            </div>
          </div>
        </div>
        <div className="min-w-0 pl-7">
          {props.children}
        </div>
      </div>
    </div>
  );
}

function StatusValue(props: {
  label: string;
  value: string;
  tone: "neutral" | "accent" | "warning";
}) {
  return (
    <SettingsActionRow density="compact">
      <span className="min-w-0 break-words text-sm">{props.label}</span>
      <StatusBadge className="shrink-0" tone={props.tone} shape="pill" size="tiny">{props.value}</StatusBadge>
    </SettingsActionRow>
  );
}

function activityLabel(activity: PermissionResult["activity"]) {
  if (activity?.phase === "running") {
    return activity.app ?? t("settings.computer_use_activity_running");
  }
  if (activity?.phase === "paused") return t("settings.computer_use_activity_paused");
  if (activity?.phase === "ready") return t("settings.computer_use_activity_ready");
  if (activity?.phase === "errored") return t("settings.computer_use_activity_error");
  return t("settings.computer_use_activity_inactive");
}

function Pill(props: { label: string; granted: boolean; checked: boolean }) {
  const { label, granted, checked } = props;
  return (
    <SettingsActionRow density="compact">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <StatusIcon complete={granted} muted={!checked} />
        <span className="truncate">{label}</span>
      </div>
      <StatusBadge className="shrink-0" tone={!checked ? "neutral" : granted ? "accent" : "warning"} shape="pill" size="tiny">
        {!checked ? "…" : granted ? t("settings.permission_granted") : t("settings.permission_needed")}
      </StatusBadge>
    </SettingsActionRow>
  );
}

function StatusIcon(props: { complete: boolean; muted?: boolean }) {
  if (props.complete) {
    return <CheckCircle2 className="size-3.5 shrink-0 text-dls-accent" />;
  }
  return (
    <CircleAlert
      className={`size-3.5 shrink-0 ${props.muted ? "text-dls-secondary" : "text-dls-status-warning"}`}
    />
  );
}
