/** @jsxImportSource react */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";

import type {
  LarkCliAuthProgress,
  LarkCliConnectionStatus,
} from "@onmyagent/types/lark-cli-auth";
import { LARK_CLI_OPEN_PLATFORM_APP_URL } from "@onmyagent/types/lark-cli-auth";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NoticeBox } from "@/components/ui/notice-box";
import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import {
  cancelLarkCliConfigInit,
  getLarkCliConnectionStatus,
  getLarkCliRecommendedScopesJson,
  startLarkCliConfigInit,
  startLarkCliUserLogin,
  submitLarkCliManualCredentials,
  subscribeLarkCliAuthProgress,
} from "@/app/lib/desktop";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type LarkCliConnectModalProps = {
  open: boolean;
  /** 1 = app credentials, 2 = user login */
  initialStep?: 1 | 2;
  initialTab?: "qr" | "manual";
  onOpenChange: (open: boolean) => void;
  onConnectionChange: (status: LarkCliConnectionStatus) => void;
};

type ConfigTab = "qr" | "manual";

/** Inline action affordance: looks clickable (accent + underline). */
const clickableTextClassName =
  "mac:titlebar-no-drag inline-flex items-center gap-1 font-medium text-dls-accent underline underline-offset-2 transition-opacity hover:opacity-80";

/** Timeouts / expired waits → silent QR refresh, not a scary banner. */
function isTransientAuthFailure(
  code?: string | null,
  message?: string | null,
): boolean {
  if (
    code === "network_timeout" ||
    code === "device_code_expired" ||
    code === "login_session_missing" ||
    // QR wait process ended without credentials — issue a new code instead of dumping exit text.
    code === "config_init_failed"
  ) {
    return true;
  }
  if (!message) return false;
  // Only match real wait timeouts — not every CLI string that mentions "device code".
  return /authorization wait timed out|lark-cli timed out|network_timeout|config init exited/i.test(
    message,
  );
}

function errorCodeFromUnknown(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" && code.length > 0 ? code : null;
  }
  return null;
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Only surface clear product failures; drop CLI dumps / secrets. */
function userFacingAuthError(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  if (isTransientAuthFailure(null, trimmed)) return null;
  if (/--device-code|auth login|config init --new/i.test(trimmed)) return null;
  return trimmed;
}

export function LarkCliConnectModal(props: LarkCliConnectModalProps) {
  const [step, setStep] = useState<1 | 2>(props.initialStep ?? 1);
  const [tab, setTab] = useState<ConfigTab>(props.initialTab ?? "qr");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 QR
  const [configUrl, setConfigUrl] = useState<string | null>(null);
  const [configQr, setConfigQr] = useState<string | null>(null);
  const [configRefreshKey, setConfigRefreshKey] = useState(0);

  // Step 1 manual
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [copyDone, setCopyDone] = useState(false);

  // Step 2 login
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [loginQr, setLoginQr] = useState<string | null>(null);
  const [loginRefreshKey, setLoginRefreshKey] = useState(0);
  const loginStartedRef = useRef(false);
  const loginRefreshTimerRef = useRef<number | null>(null);
  const configRefreshTimerRef = useRef<number | null>(null);

  const scheduleLoginRefresh = useCallback(() => {
    if (loginRefreshTimerRef.current != null) return;
    loginRefreshTimerRef.current = window.setTimeout(() => {
      loginRefreshTimerRef.current = null;
      loginStartedRef.current = false;
      setError(null);
      setLoginUrl(null);
      setLoginQr(null);
      setLoginRefreshKey((key) => key + 1);
    }, 400);
  }, []);

  const scheduleConfigRefresh = useCallback(() => {
    if (configRefreshTimerRef.current != null) return;
    configRefreshTimerRef.current = window.setTimeout(() => {
      configRefreshTimerRef.current = null;
      setError(null);
      setConfigUrl(null);
      setConfigQr(null);
      setConfigRefreshKey((key) => key + 1);
    }, 400);
  }, []);

  useEffect(() => {
    if (!props.open) return;
    setStep(props.initialStep ?? 1);
    setTab(props.initialTab ?? "qr");
    setError(null);
    setBusy(false);
    setCopyDone(false);
    setAppId("");
    setAppSecret("");
    setConfigUrl(null);
    setConfigQr(null);
    setLoginUrl(null);
    setLoginQr(null);
    setConfigRefreshKey(0);
    setLoginRefreshKey(0);
    loginStartedRef.current = false;
  }, [props.open, props.initialStep, props.initialTab]);

  useEffect(() => {
    return () => {
      if (loginRefreshTimerRef.current != null) {
        window.clearTimeout(loginRefreshTimerRef.current);
      }
      if (configRefreshTimerRef.current != null) {
        window.clearTimeout(configRefreshTimerRef.current);
      }
    };
  }, []);

  const advanceToLogin = useCallback(
    async (status?: LarkCliConnectionStatus) => {
      if (status) props.onConnectionChange(status);
      else {
        try {
          props.onConnectionChange(await getLarkCliConnectionStatus());
        } catch {
          // ignore
        }
      }
      setStep(2);
      loginStartedRef.current = false;
    },
    [props],
  );

  const finishLoginSuccess = useCallback(
    async (status?: LarkCliConnectionStatus) => {
      try {
        const next = status ?? (await getLarkCliConnectionStatus());
        props.onConnectionChange(next);
      } catch {
        // ignore
      }
      props.onOpenChange(false);
    },
    [props],
  );

  useEffect(() => {
    if (!props.open) return undefined;
    return subscribeLarkCliAuthProgress((progress: LarkCliAuthProgress) => {
      if (progress.verificationUrl) {
        if (progress.operation === "config_init") {
          setConfigUrl(progress.verificationUrl);
          if (progress.qrcodeDataUrl) setConfigQr(progress.qrcodeDataUrl);
          setBusy(false);
        }
        if (progress.operation === "user_login") {
          setLoginUrl(progress.verificationUrl);
          if (progress.qrcodeDataUrl) setLoginQr(progress.qrcodeDataUrl);
        }
      }
      if (progress.phase === "complete" && progress.operation === "config_init") {
        void advanceToLogin();
      }
      if (progress.phase === "complete" && progress.operation === "user_login") {
        void finishLoginSuccess();
      }
      if (
        progress.phase === "expired" ||
        (progress.phase === "error" &&
          isTransientAuthFailure(progress.errorCode, progress.errorMessage))
      ) {
        setBusy(false);
        setError(null);
        if (progress.operation === "user_login") scheduleLoginRefresh();
        if (progress.operation === "config_init") scheduleConfigRefresh();
        return;
      }
      if (progress.phase === "error" && progress.errorMessage) {
        if (
          progress.operation === "user_login" ||
          progress.operation === "config_init"
        ) {
          const facing = userFacingAuthError(progress.errorMessage);
          if (facing) setError(facing);
        }
        setBusy(false);
      }
    });
  }, [
    props.open,
    advanceToLogin,
    finishLoginSuccess,
    scheduleLoginRefresh,
    scheduleConfigRefresh,
  ]);

  const startLoginFlow = useCallback(async () => {
    if (loginStartedRef.current) return;
    loginStartedRef.current = true;
    setBusy(true);
    setError(null);
    setLoginUrl(null);
    setLoginQr(null);
    try {
      // Main process starts a long-lived device-code wait (up to 15 min) in the
      // background and emits auth-progress. Do NOT await completeUserLogin here —
      // that reuses a rejected promise after a prior timeout and looks "instant".
      const started = await startLarkCliUserLogin();
      if (started.alreadyLoggedIn) {
        await finishLoginSuccess();
        return;
      }
      setLoginUrl(started.verificationUrl);
      setLoginQr(started.qrcodeDataUrl);
    } catch (e) {
      loginStartedRef.current = false;
      const code = errorCodeFromUnknown(e);
      const message = messageFromUnknown(e);
      if (isTransientAuthFailure(code, message)) {
        scheduleLoginRefresh();
        return;
      }
      const facing = userFacingAuthError(message);
      if (facing) setError(facing);
    } finally {
      setBusy(false);
    }
  }, [finishLoginSuccess, scheduleLoginRefresh]);

  useEffect(() => {
    if (!props.open || step !== 2) return;
    if (loginStartedRef.current) return;
    void startLoginFlow();
  }, [props.open, step, startLoginFlow, loginRefreshKey]);

  // Step 2: poll until user token is valid, then close modal + refresh card.
  // Complements main-process device-code poll / auth-progress events.
  useEffect(() => {
    if (!props.open || step !== 2) return;
    let stopped = false;
    const tick = async () => {
      try {
        const status = await getLarkCliConnectionStatus();
        if (stopped) return;
        if (status.phase === "connected_logged_in") {
          await finishLoginSuccess(status);
        }
      } catch {
        // keep waiting
      }
    };
    const id = window.setInterval(() => {
      void tick();
    }, 2000);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [props.open, step, finishLoginSuccess]);

  // Start config init once per open+QR tab (or silent refresh after timeout).
  // Do NOT depend on configUrl — otherwise setting the URL re-runs cleanup
  // and kills the waiting process.
  useEffect(() => {
    if (!props.open || step !== 1 || tab !== "qr") return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const result = await startLarkCliConfigInit();
        if (cancelled) return;
        if (result.verificationUrl) setConfigUrl(result.verificationUrl);
        if (result.qrcodeDataUrl) setConfigQr(result.qrcodeDataUrl);
        if (!result.pending && result.exitCode === 0) {
          await advanceToLogin();
        }
      } catch (e) {
        if (cancelled) return;
        const code = errorCodeFromUnknown(e);
        const message = messageFromUnknown(e);
        if (isTransientAuthFailure(code, message) || code === "busy") {
          // busy = previous child still tearing down — retry shortly.
          scheduleConfigRefresh();
          return;
        }
        const facing = userFacingAuthError(message);
        if (facing) setError(facing);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      void cancelLarkCliConfigInit();
    };
  }, [props.open, step, tab, advanceToLogin, configRefreshKey, scheduleConfigRefresh]);

  // Backup: poll local CLI config until app credentials appear after scan.
  useEffect(() => {
    if (!props.open || step !== 1 || tab !== "qr" || !configUrl) return;
    let stopped = false;
    const tick = async () => {
      try {
        const status = await getLarkCliConnectionStatus();
        if (stopped) return;
        if (
          status.phase === "connected_not_logged_in" ||
          status.phase === "connected_logged_in"
        ) {
          await advanceToLogin(status);
        }
      } catch {
        // keep waiting
      }
    };
    const id = window.setInterval(() => {
      void tick();
    }, 2000);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [props.open, step, tab, configUrl, advanceToLogin]);

  const handleClose = (open: boolean) => {
    if (!open) {
      void cancelLarkCliConfigInit();
    }
    props.onOpenChange(open);
  };

  const handleCopyScopes = async () => {
    try {
      const json = await getLarkCliRecommendedScopesJson();
      await navigator.clipboard.writeText(json);
      setCopyDone(true);
      window.setTimeout(() => setCopyDone(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleManualContinue = async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await submitLarkCliManualCredentials({
        appId: appId.trim(),
        appSecret: appSecret.trim(),
        brand: "feishu",
      });
      setAppSecret("");
      await advanceToLogin(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-dls-border px-5 py-4 text-left">
          <DialogTitle>{t("plugins.larkcli_connect_title")}</DialogTitle>
          <DialogDescription>{t("plugins.larkcli_connect_subtitle")}</DialogDescription>
          {/* Centered process stepper: completed / current / pending */}
          <nav
            className="mt-5 flex w-full items-start justify-center"
            aria-label={`${t("plugins.larkcli_step_config")} → ${t("plugins.larkcli_step_login")}`}
          >
            <ol className="flex items-start gap-0">
              {/* Step 1 — completed: solid green circle + check (same size-9 as number). */}
              <li className="flex w-28 flex-col items-center gap-2 sm:w-32">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold shadow-sm ring-4",
                    step === 1
                      ? "bg-dls-accent text-white ring-dls-accent/15"
                      : "bg-dls-status-success-fg text-white ring-dls-status-success-fg/20",
                  )}
                >
                  {step === 2 ? (
                    <Check className="size-4" strokeWidth={2.5} aria-hidden />
                  ) : (
                    "1"
                  )}
                </span>
                <span
                  className={cn(
                    "text-center text-xs font-medium leading-tight",
                    step === 1
                      ? "text-dls-accent"
                      : "text-dls-status-success-fg",
                  )}
                >
                  {t("plugins.larkcli_step_config")}
                </span>
              </li>

              {/* Connector: single shaft + arrowhead (no gap); green when step 1 done. */}
              <li
                className="mt-[1.125rem] flex w-12 shrink-0 items-center sm:w-16"
                aria-hidden
              >
                <span
                  className={cn(
                    "relative block h-0.5 w-full rounded-full",
                    step === 2
                      ? "bg-dls-status-success-fg"
                      : "bg-dls-border-strong",
                    // Arrowhead flush with the shaft end.
                    "after:absolute after:end-0 after:top-1/2 after:size-0 after:-translate-y-1/2",
                    "after:border-y-[4px] after:border-y-transparent after:border-s-[6px]",
                    step === 2
                      ? "after:border-s-dls-status-success-fg"
                      : "after:border-s-dls-border-strong",
                  )}
                />
              </li>

              {/* Step 2 — same circle size; green+check only if ever shown completed. */}
              <li className="flex w-28 flex-col items-center gap-2 sm:w-32">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold shadow-sm ring-4",
                    step === 2
                      ? "bg-dls-accent text-white ring-dls-accent/15"
                      : "bg-dls-surface-muted text-dls-secondary ring-transparent",
                  )}
                >
                  2
                </span>
                <span
                  className={cn(
                    "text-center text-xs font-medium leading-tight",
                    step === 2 ? "text-dls-accent" : "text-dls-secondary",
                  )}
                >
                  {t("plugins.larkcli_step_login")}
                </span>
              </li>
            </ol>
          </nav>
        </DialogHeader>

        <div className="max-h-[min(70vh,560px)] space-y-4 overflow-y-auto px-5 py-4">
          {error ? (
            <NoticeBox tone="error" role="alert">
              {error}
            </NoticeBox>
          ) : null}

          {step === 1 ? (
            <>
              <div className="flex justify-center">
                <SegmentedTabGroup density="filter" className="w-full max-w-md">
                  <NavTabButton
                    type="button"
                    active={tab === "qr"}
                    size="tab"
                    shape="tab"
                    data-active={tab === "qr" ? "true" : undefined}
                    aria-pressed={tab === "qr"}
                    className={cn(
                      "min-h-0 flex-1",
                      // Soft wash fills the track segment; inverted black blends into dialog surface.
                      tab === "qr" &&
                        "!bg-dls-list-selected !text-dls-text shadow-none hover:!bg-dls-list-selected",
                    )}
                    onClick={() => {
                      setTab("qr");
                      setConfigUrl(null);
                      setConfigQr(null);
                    }}
                  >
                    {t("plugins.larkcli_tab_qr")}
                  </NavTabButton>
                  <NavTabButton
                    type="button"
                    active={tab === "manual"}
                    size="tab"
                    shape="tab"
                    data-active={tab === "manual" ? "true" : undefined}
                    aria-pressed={tab === "manual"}
                    className={cn(
                      "min-h-0 flex-1",
                      tab === "manual" &&
                        "!bg-dls-list-selected !text-dls-text shadow-none hover:!bg-dls-list-selected",
                    )}
                    onClick={() => {
                      setTab("manual");
                      void cancelLarkCliConfigInit();
                    }}
                  >
                    {t("plugins.larkcli_tab_manual")}
                  </NavTabButton>
                </SegmentedTabGroup>
              </div>

              {tab === "qr" ? (
                <div className="space-y-5 rounded-2xl border border-dls-border bg-dls-surface p-5 shadow-sm">
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-dls-text">
                      {t("plugins.larkcli_qr_howto_title")}
                    </p>
                    <ul className="space-y-3 text-sm leading-relaxed text-dls-secondary">
                      <li className="flex gap-2.5">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-dls-accent/12 text-[11px] font-semibold text-dls-accent">
                          1
                        </span>
                        <span>{t("plugins.larkcli_qr_step1")}</span>
                      </li>
                      <li className="flex gap-2.5">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-dls-accent/12 text-[11px] font-semibold text-dls-accent">
                          2
                        </span>
                        <span>
                          {t("plugins.larkcli_qr_step2_prefix")}
                          <button
                            type="button"
                            disabled={!configUrl}
                            className={cn(
                              clickableTextClassName,
                              !configUrl && "cursor-not-allowed opacity-50 no-underline",
                            )}
                            onClick={() => {
                              if (!configUrl) return;
                              window.open(configUrl, "_blank", "noopener,noreferrer");
                            }}
                          >
                            {t("plugins.larkcli_qr_step2_link")}
                            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                          </button>
                          {t("plugins.larkcli_qr_step2_suffix")}
                        </span>
                      </li>
                      <li className="flex gap-2.5">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-dls-accent/12 text-[11px] font-semibold text-dls-accent">
                          3
                        </span>
                        <span>{t("plugins.larkcli_qr_step3")}</span>
                      </li>
                    </ul>
                  </div>
                  <div className="flex flex-col items-center justify-center gap-3">
                    <div className="rounded-2xl border border-dls-border bg-white p-3 shadow-sm dark:bg-dls-surface">
                      {configQr ? (
                        <img
                          src={configQr}
                          alt=""
                          className="size-40 rounded-lg"
                        />
                      ) : (
                        <div className="flex size-40 items-center justify-center">
                          {busy ? (
                            <Loader2 className="size-8 animate-spin text-dls-secondary" />
                          ) : (
                            <span className="px-3 text-center text-xs text-dls-secondary">
                              {t("plugins.larkcli_qr_waiting")}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="max-w-xs text-center text-xs text-dls-secondary">
                      {t("plugins.larkcli_qr_waiting")}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-xl border border-dls-border bg-dls-surface shadow-sm">
                    <div className="border-b border-dls-border bg-dls-surface-muted/30 px-3.5 py-2">
                      <p className="text-xs font-semibold text-dls-text">
                        {t("plugins.larkcli_manual_steps_title")}
                      </p>
                    </div>
                    <ol className="divide-y divide-dls-border text-xs text-dls-secondary">
                      <li className="flex gap-2 px-3.5 py-1.5">
                        <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-dls-surface-muted text-[10px] font-semibold text-dls-text">
                          1
                        </span>
                        <span className="leading-snug">
                          {t("plugins.larkcli_manual_step1_prefix")}{" "}
                          <a
                            href={LARK_CLI_OPEN_PLATFORM_APP_URL}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(clickableTextClassName, "text-xs")}
                          >
                            {t("plugins.larkcli_open_platform")}
                            <ExternalLink className="size-3 shrink-0" aria-hidden />
                          </a>
                          {t("plugins.larkcli_manual_step1_suffix")}
                        </span>
                      </li>
                      <li className="flex gap-2 px-3.5 py-1.5">
                        <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-dls-surface-muted text-[10px] font-semibold text-dls-text">
                          2
                        </span>
                        <span className="leading-snug">
                          {t("plugins.larkcli_manual_step2")}
                        </span>
                      </li>
                      <li className="flex gap-2 px-3.5 py-1.5">
                        <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-dls-surface-muted text-[10px] font-semibold text-dls-text">
                          3
                        </span>
                        <span className="leading-snug">
                          {t("plugins.larkcli_manual_step3")}{" "}
                          <button
                            type="button"
                            className={cn(clickableTextClassName, "text-xs")}
                            onClick={() => void handleCopyScopes()}
                          >
                            <Copy className="size-3 shrink-0" aria-hidden />
                            {copyDone
                              ? t("plugins.larkcli_scopes_copied")
                              : t("plugins.larkcli_copy_scopes")}
                          </button>
                        </span>
                      </li>
                      <li className="flex gap-2 px-3.5 py-1.5">
                        <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-dls-surface-muted text-[10px] font-semibold text-dls-text">
                          4
                        </span>
                        <span className="leading-snug">
                          {t("plugins.larkcli_manual_step4")}
                        </span>
                      </li>
                      <li className="flex gap-2 px-3.5 py-1.5">
                        <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-dls-surface-muted text-[10px] font-semibold text-dls-text">
                          5
                        </span>
                        <span className="leading-snug">
                          {t("plugins.larkcli_manual_step5")}
                        </span>
                      </li>
                    </ol>
                  </div>
                  <div className="space-y-3 rounded-2xl border border-dls-border bg-dls-surface p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-dls-text">
                        {t("plugins.larkcli_manual_credentials_title")}
                      </p>
                      <Button
                        size="sm"
                        disabled={busy || !appId.trim() || !appSecret.trim()}
                        onClick={() => void handleManualContinue()}
                      >
                        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                        {t("plugins.larkcli_continue")}
                      </Button>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="lark-app-id">
                          App ID <span className="text-dls-danger">*</span>
                        </Label>
                        <Input
                          id="lark-app-id"
                          value={appId}
                          onChange={(e) => setAppId(e.target.value)}
                          placeholder="cli_xxxxxxxx"
                          autoComplete="off"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="lark-app-secret">
                          App Secret <span className="text-dls-danger">*</span>
                        </Label>
                        <Input
                          id="lark-app-secret"
                          type="password"
                          value={appSecret}
                          onChange={(e) => setAppSecret(e.target.value)}
                          placeholder="Your Lark App Secret"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-5 rounded-2xl border border-dls-border bg-dls-surface p-5 shadow-sm">
              <div className="space-y-3">
                <p className="text-sm font-semibold text-dls-text">
                  {t("plugins.larkcli_login_howto_title")}
                </p>
                <ul className="space-y-3 text-sm leading-relaxed text-dls-secondary">
                  <li className="flex gap-2.5">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-dls-accent/12 text-[11px] font-semibold text-dls-accent">
                      1
                    </span>
                    <span>{t("plugins.larkcli_login_step1")}</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-dls-accent/12 text-[11px] font-semibold text-dls-accent">
                      2
                    </span>
                    <span>
                      {t("plugins.larkcli_login_step2_prefix")}
                      <button
                        type="button"
                        disabled={!loginUrl}
                        className={cn(
                          clickableTextClassName,
                          !loginUrl && "cursor-not-allowed opacity-50 no-underline",
                        )}
                        onClick={() => {
                          if (!loginUrl) return;
                          window.open(loginUrl, "_blank", "noopener,noreferrer");
                        }}
                      >
                        {t("plugins.larkcli_login_step2_link")}
                        <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                      </button>
                      {t("plugins.larkcli_login_step2_suffix")}
                    </span>
                  </li>
                </ul>
              </div>
              <div className="flex flex-col items-center justify-center gap-3">
                <div className="rounded-2xl border border-dls-border bg-white p-3 shadow-sm dark:bg-dls-surface">
                  {loginQr ? (
                    <img src={loginQr} alt="" className="size-40 rounded-lg" />
                  ) : (
                    <div className="flex size-40 items-center justify-center">
                      {busy ? (
                        <Loader2 className="size-8 animate-spin text-dls-secondary" />
                      ) : (
                        <span className="px-3 text-center text-xs text-dls-secondary">
                          {t("plugins.larkcli_login_waiting")}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <p className="max-w-xs text-center text-xs text-dls-secondary">
                  {t("plugins.larkcli_login_waiting")}
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
