/** @jsxImportSource react */
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";

import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Button } from "@/components/ui/button";
import {
  desktopBridge,
  subscribeSoftwareEnvironmentProgress,
  type SoftwareEnvironmentProgress,
} from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsPageSection,
} from "../settings-section";

type SoftwareEnvStatus = {
  node: boolean;
  python: boolean;
  opencode: boolean;
  details?: Record<
    "node" | "python" | "opencode",
    {
      installed: boolean;
      bundled: boolean;
      path: string | null;
      version: string | null;
    }
  >;
};

type InstallState = "idle" | "installing" | "installed" | "error";
type StatusLoadState = "loading" | "ready" | "error";

/**
 * Session-level cache: checkSoftwareEnv probes the disk and can feel stuck
 * every time Settings → Environment remounts. Fetch once, then only on
 * manual refresh (or after install).
 */
let softwareEnvStatusCache: SoftwareEnvStatus | null = null;
let softwareEnvStatusInflight: Promise<SoftwareEnvStatus> | null = null;

function NodeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" fill="#689F63" />
      <text
        x="12"
        y="15"
        textAnchor="middle"
        fill="white"
        fontSize="8"
        fontWeight="bold"
      >
        JS
      </text>
    </svg>
  );
}

function PythonIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M12 2C8 2 8.5 3.5 8.5 3.5V6H12v1H5.5S3 6.5 3 12s2 5.5 2 5.5h1.5v-2.5s-.2-2.5 2.5-2.5h4s2.5 0 2.5-2.5V5.5S16 2 12 2z"
        fill="#3776AB"
      />
      <path
        d="M12 22c4 0 3.5-1.5 3.5-1.5V18H12v-1h6.5S21 17.5 21 12s-2-5.5-2-5.5h-1.5v2.5s.2 2.5-2.5 2.5h-4S8.5 11.5 8.5 14v4.5S8 22 12 22z"
        fill="#FFD43B"
      />
    </svg>
  );
}

function OpencodeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M18 6H6v12h12V6z" fill="#CFCECD" />
      <path d="M18 4H6v14h12V4zM22 22H2V2h20v20z" fill="#211E1E" />
    </svg>
  );
}

const tools = [
  {
    id: "opencode" as const,
    // Product-facing: local agent runtime (engine), not third-party brand.
    get name() {
      return t("settings.software_env.runtime_name");
    },
    get description() {
      return t("settings.software_env.opencode_desc");
    },
    Icon: OpencodeIcon,
  },
  {
    id: "node" as const,
    name: "Node.js",
    get description() {
      return t("settings.software_env.nodejs_desc");
    },
    Icon: NodeIcon,
  },
  {
    id: "python" as const,
    name: "Python",
    get description() {
      return t("settings.software_env.python_desc");
    },
    Icon: PythonIcon,
  },
];

async function fetchSoftwareEnvStatus(options?: {
  force?: boolean;
}): Promise<SoftwareEnvStatus> {
  if (options?.force) {
    softwareEnvStatusInflight = null;
  } else if (softwareEnvStatusInflight) {
    return softwareEnvStatusInflight;
  }
  softwareEnvStatusInflight = (async () => {
    try {
      const result =
        (await desktopBridge.checkSoftwareEnv()) as SoftwareEnvStatus;
      softwareEnvStatusCache = result;
      return result;
    } finally {
      softwareEnvStatusInflight = null;
    }
  })();
  return softwareEnvStatusInflight;
}

export function SoftwareEnvironmentSection() {
  const [status, setStatus] = useState<SoftwareEnvStatus | null>(
    () => softwareEnvStatusCache,
  );
  const [statusLoadState, setStatusLoadState] = useState<StatusLoadState>(() =>
    softwareEnvStatusCache ? "ready" : "loading",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState<Record<string, InstallState>>(
    {},
  );
  const [errorMsg, setErrorMsg] = useState<Record<string, string>>({});
  const [installProgress, setInstallProgress] =
    useState<SoftwareEnvironmentProgress | null>(null);
  const installRequestIdRef = useRef("");
  const didAutoLoadRef = useRef(false);

  const checkStatus = useCallback(async (options?: { force?: boolean }) => {
    const force = Boolean(options?.force);
    if (!force && softwareEnvStatusCache) {
      setStatus(softwareEnvStatusCache);
      setStatusLoadState("ready");
      return softwareEnvStatusCache;
    }
    const hasCache = Boolean(softwareEnvStatusCache);
    // First load: show row spinners. Manual refresh: keep last status, spin the button.
    if (!hasCache) setStatusLoadState("loading");
    if (force && hasCache) setRefreshing(true);
    try {
      const result = await fetchSoftwareEnvStatus({ force });
      setStatus(result);
      setStatusLoadState("ready");
      return result;
    } catch {
      if (!softwareEnvStatusCache) {
        setStatus({ node: false, python: false, opencode: false });
        setStatusLoadState("error");
      }
      return softwareEnvStatusCache;
    } finally {
      setRefreshing(false);
    }
  }, []);

  // First entry in this process: load once. Later remounts reuse the cache.
  useEffect(() => {
    if (didAutoLoadRef.current) return;
    didAutoLoadRef.current = true;
    if (softwareEnvStatusCache) {
      setStatus(softwareEnvStatusCache);
      setStatusLoadState("ready");
      return;
    }
    void checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    return subscribeSoftwareEnvironmentProgress((progress) => {
      if (progress.requestId === installRequestIdRef.current) {
        setInstallProgress(progress);
      }
    });
  }, []);

  if (!isDesktopRuntime()) {
    return null;
  }

  const handleRefresh = () => {
    void checkStatus({ force: true });
  };

  const handleInstall = async (toolId: string) => {
    if (toolId !== "opencode") return;
    const requestId = crypto.randomUUID();
    installRequestIdRef.current = requestId;
    setInstallProgress({
      requestId,
      tool: toolId,
      progress: 0,
      phase: "starting",
      message: t("settings.software_env.install_preparing"),
    });
    setInstalling((prev) => ({ ...prev, [toolId]: "installing" }));
    setErrorMsg((prev) => ({ ...prev, [toolId]: "" }));
    try {
      const result = (await desktopBridge.installSoftwareEnv(
        toolId,
        requestId,
      )) as { ok: boolean; message?: string };
      if (result.ok) {
        setInstalling((prev) => ({ ...prev, [toolId]: "installed" }));
        await checkStatus({ force: true });
      } else {
        setInstalling((prev) => ({ ...prev, [toolId]: "error" }));
        setErrorMsg((prev) => ({
          ...prev,
          [toolId]: result.message ?? t("settings.software_env.install_failed"),
        }));
      }
    } catch {
      setInstalling((prev) => ({ ...prev, [toolId]: "error" }));
      setErrorMsg((prev) => ({
        ...prev,
        [toolId]: t("settings.software_env.install_failed"),
      }));
    }
  };

  const isInstalled = (toolId: string) => {
    if (status && toolId in status) {
      if (toolId === "node") return status.node;
      if (toolId === "python") return status.python;
      if (toolId === "opencode") return status.opencode;
    }
    return false;
  };

  const getInstallState = (toolId: string): InstallState => {
    if (isInstalled(toolId)) return "installed";
    return installing[toolId] ?? "idle";
  };

  const isStatusLoading = statusLoadState === "loading" && !status;
  const isStatusError = statusLoadState === "error" && !status;

  return (
    <SettingsPageSection
      title={t("settings.software_env.title")}
      description={t("settings.software_env.description")}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isStatusLoading || refreshing}
          title={t("settings.software_env.refresh")}
          aria-label={t("settings.software_env.refresh")}
        >
          <RefreshCw
            className={cn(
              "mr-1.5 size-3.5",
              (isStatusLoading || refreshing) && "animate-spin",
            )}
          />
          {refreshing || isStatusLoading
            ? t("settings.software_env.refreshing")
            : t("settings.software_env.refresh")}
        </Button>
      }
    >
      <SettingsBlock>
        {tools.map((tool) => {
          const state = getInstallState(tool.id);
          const detail = status?.details?.[tool.id];

          const actions = (() => {
            // Only block rows on the very first load (no cache yet).
            if (isStatusLoading) {
              return (
                <span className="inline-flex items-center gap-1.5 text-sm text-dls-secondary">
                  <LoadingSpinner size="default" />
                  {t("settings.software_env.loading")}
                </span>
              );
            }
            if (state === "installed") {
              return (
                <div className="flex flex-col items-end gap-0.5">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-dls-accent">
                    <CheckCircle2 className="size-4" />
                    {detail?.bundled
                      ? t("settings.software_env.bundled")
                      : t("settings.software_env.installed")}
                  </span>
                  {detail?.version ? (
                    <span className="text-xs text-dls-secondary">
                      {detail.version}
                    </span>
                  ) : null}
                </div>
              );
            }
            if (state === "installing") {
              return (
                <div className="flex min-w-40 flex-col items-end gap-1.5">
                  <span className="inline-flex items-center gap-1.5 text-sm text-dls-secondary">
                    <LoadingSpinner size="default" />
                    {installProgress?.message ??
                      t("settings.software_env.installing")}
                  </span>
                  <div className="h-1.5 w-36 overflow-hidden rounded-full bg-dls-surface-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300"
                      style={{
                        width: `${installProgress?.progress ?? 5}%`,
                      }}
                    />
                  </div>
                </div>
              );
            }
            if (state === "error") {
              return (
                <div className="flex flex-col items-end gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleInstall(tool.id)}
                  >
                    {t("settings.software_env.retry")}
                  </Button>
                  <span className="max-w-40 text-right text-xs text-dls-status-danger-fg">
                    {errorMsg[tool.id]}
                  </span>
                </div>
              );
            }
            if (isStatusError) {
              return (
                <span className="text-sm text-dls-status-danger-fg">
                  {t("settings.software_env.status_unavailable")}
                </span>
              );
            }
            if (tool.id === "opencode") {
              return (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleInstall(tool.id)}
                >
                  {t("settings.software_env.install")}
                </Button>
              );
            }
            return (
              <span className="text-sm text-dls-secondary">
                {t("settings.software_env.bundled_missing")}
              </span>
            );
          })();

          return (
            <SettingsBlockRow
              key={tool.id}
              title={
                <span className="inline-flex items-center gap-2">
                  <tool.Icon className="size-5 shrink-0" />
                  {tool.name}
                </span>
              }
              description={tool.description}
              actions={actions}
            />
          );
        })}
      </SettingsBlock>
    </SettingsPageSection>
  );
}
