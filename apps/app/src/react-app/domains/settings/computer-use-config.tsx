/** @jsxImportSource react */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  RefreshCw,
  Settings2,
} from "lucide-react";

import { desktopBridge } from "../../../app/lib/desktop";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { registerExtensionConfig } from "./extension-registry";
import { SettingsActionRow } from "./settings-section";
import { t } from "@/i18n";
import { APP_NAME } from "../../../i18n/locales/brand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PermissionResult = {
  ok: boolean;
  accessibility: boolean;
  screenRecording: boolean;
  error?: string;
};

type ComputerUseConfigProps = {
  connected: boolean;
  connecting: boolean;
  onConnect?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
};

const computerUseLayoutClass = {
  content: "space-y-4",
  actionButton: "min-h-10 w-full whitespace-normal text-center lg:w-auto",
  primaryActionButton: "min-h-10 w-full justify-center whitespace-normal text-center",
  buttonLabel: "min-w-0 break-words",
  permissionsStack: "flex w-full min-w-0 flex-col gap-3",
  permissionGrid: "grid gap-2 xl:grid-cols-2",
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
  const [error, setError] = useState<string | null>(null);

  // Spawn --check → fresh TCC read. Works whether or not the GUI is open.
  const verify = useCallback(async () => {
    if (!hasDesktopBridge()) {
      setError(
        `Computer Use setup requires the ${APP_NAME} desktop app on macOS.`,
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
      setError(`${APP_NAME}ork desktop is required.`);
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

        {/* Step 1 — MCP */}
        <SetupRow
          title={t("extensions.computer_use_connect_mcp")}
          description={t("settings.computer_use_connect_mcp_desc")}
          complete={props.connected}
        >
          <Button
            className={computerUseLayoutClass.actionButton}
            onClick={() => void props.onConnect?.()}
            disabled={!props.onConnect || props.connected || props.connecting}
          >
            {props.connecting ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : null}
            <span className={computerUseLayoutClass.buttonLabel}>
              {props.connected
                ? t("settings.computer_use_configured")
                : props.connecting
                  ? "Connecting…"
                  : "Connect MCP"}
            </span>
          </Button>
        </SetupRow>

        {/* Step 2 — Permissions */}
        <SetupRow
          title="2. Grant macOS permissions"
          description={`Opens the ${APP_NAME} Computer Use helper. Grant both permissions there, then click Verify below.`}
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
                <Loader2 className="size-4 shrink-0 animate-spin" />
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
      </CardContent>

      <CardFooter className="border-t border-border">
        <div className={computerUseLayoutClass.footer}>
          <p className="text-xs text-muted-foreground">
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
                <Loader2 className="size-4 shrink-0 animate-spin" />
              ) : null}
              {t("settings.computer_use_verify_permissions")}
            </Button>
          </div>
        </div>
      </CardFooter>
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
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          <StatusIcon complete={props.complete} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-card-foreground">
              {props.title}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {props.description}
            </div>
          </div>
        </div>
        <div className="w-full min-w-0 xl:w-[min(22rem,44%)]">
          {props.children}
        </div>
      </div>
    </div>
  );
}

function Pill(props: { label: string; granted: boolean; checked: boolean }) {
  const { label, granted, checked } = props;
  return (
    <SettingsActionRow density="compact">
      <div className="flex items-center gap-2 text-sm">
        <StatusIcon complete={granted} muted={!checked} />
        <span className="truncate">{label}</span>
      </div>
      <StatusBadge tone={!checked ? "neutral" : granted ? "accent" : "warning"}>
        {!checked ? "…" : granted ? t("settings.permission_granted") : t("settings.permission_needed")}
      </StatusBadge>
    </SettingsActionRow>
  );
}

function StatusIcon(props: { complete: boolean; muted?: boolean }) {
  if (props.complete) {
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-dls-accent" />;
  }
  return (
    <CircleAlert
      className={`mt-0.5 size-4 shrink-0 ${props.muted ? "text-muted-foreground" : "text-dls-status-warning"}`}
    />
  );
}
