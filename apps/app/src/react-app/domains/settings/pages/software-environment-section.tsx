import { LoadingSpinner } from "@/components/ui/loading-spinner";
/** @jsxImportSource react */
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  desktopBridge,
  subscribeSoftwareEnvironmentProgress,
  type SoftwareEnvironmentProgress,
} from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionTitle,
} from "../settings-layout";

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

function NodeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M12 2L3 7v10l9 5 9-5V7l-9-5z"
        fill="#689F63"
      />
      <text x="12" y="15" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">
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
      <path
        d="M18 6H6v12h12V6z"
        fill="#CFCECD"
      />
      <path
        d="M18 4H6v14h12V4zM22 22H2V2h20v20z"
        fill="#211E1E"
      />
    </svg>
  );
}

const tools = [
  {
    id: "opencode" as const,
    name: "OpenCode",
    get description() { return t("settings.software_env.opencode_desc"); },
    Icon: OpencodeIcon,
  },
  {
    id: "node" as const,
    name: "Node.js",
    get description() { return t("settings.software_env.nodejs_desc"); },
    Icon: NodeIcon,
  },
  {
    id: "python" as const,
    name: "Python",
    get description() { return t("settings.software_env.python_desc"); },
    Icon: PythonIcon,
  },
];

const softwareEnvLayoutClass = {
  description: "max-w-[52ch]",
  tableShell: "overflow-hidden rounded-lg border border-border",
  table: "w-full text-sm",
  tableHead: "bg-muted/50",
  headerRow: "border-b border-border",
  toolHeader: "px-4 py-3 text-left font-medium text-muted-foreground w-1/4",
  descriptionHeader: "px-4 py-3 text-left font-medium text-muted-foreground",
  statusHeader: "px-4 py-3 text-right font-medium text-muted-foreground w-32",
  tableRow: "border-b border-border last:border-b-0",
  cell: "px-4 py-3",
  descriptionCell: "px-4 py-3 text-muted-foreground",
  statusCell: "px-4 py-3 text-right",
  installedStack: "flex flex-col items-end gap-0.5",
  installedLabel: "inline-flex items-center gap-1.5 text-sm text-dls-accent font-medium",
  installingStack: "flex min-w-44 flex-col items-end gap-1.5",
  installingLabel: "inline-flex items-center gap-1 text-sm text-muted-foreground",
  loadingLabel: "inline-flex items-center gap-1 text-sm text-muted-foreground",
  progressTrack: "h-1.5 w-44 overflow-hidden rounded-full bg-muted",
  progressFill: "h-full rounded-full bg-primary transition-[width] duration-300",
  errorStack: "flex flex-col items-end gap-1",
  errorText: "text-xs text-dls-status-danger-fg",
};

export function SoftwareEnvironmentSection() {
  const [status, setStatus] = useState<SoftwareEnvStatus | null>(null);
  const [statusLoadState, setStatusLoadState] = useState<StatusLoadState>("loading");
  const [installing, setInstalling] = useState<Record<string, InstallState>>({});
  const [errorMsg, setErrorMsg] = useState<Record<string, string>>({});
  const [installProgress, setInstallProgress] =
    useState<SoftwareEnvironmentProgress | null>(null);
  const installRequestIdRef = useRef("");

  const checkStatus = useCallback(async () => {
    setStatusLoadState("loading");
    try {
      const result = (await desktopBridge.checkSoftwareEnv()) as SoftwareEnvStatus;
      setStatus(result);
      setStatusLoadState("ready");
    } catch {
      setStatus({ node: false, python: false, opencode: false });
      setStatusLoadState("error");
    }
  }, []);

  useEffect(() => {
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
      const result = (await desktopBridge.installSoftwareEnv(toolId, requestId)) as { ok: boolean; message?: string };
      if (result.ok) {
        setInstalling((prev) => ({ ...prev, [toolId]: "installed" }));
        await checkStatus();
      } else {
        setInstalling((prev) => ({ ...prev, [toolId]: "error" }));
        setErrorMsg((prev) => ({ ...prev, [toolId]: result.message ?? t("settings.software_env.install_failed") }));
      }
    } catch {
      setInstalling((prev) => ({ ...prev, [toolId]: "error" }));
      setErrorMsg((prev) => ({ ...prev, [toolId]: t("settings.software_env.install_failed") }));
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

  const isStatusLoading = statusLoadState === "loading";
  const isStatusError = statusLoadState === "error";

  return (
    <LayoutSection>
      <LayoutSectionHeader>
        <LayoutSectionTitle>{t("settings.software_env.title")}</LayoutSectionTitle>
        <LayoutSectionDescription className={softwareEnvLayoutClass.description}>
          {t("settings.software_env.description")}
        </LayoutSectionDescription>
      </LayoutSectionHeader>

      <div className={softwareEnvLayoutClass.tableShell}>
        <table className={softwareEnvLayoutClass.table}>
          <thead className={softwareEnvLayoutClass.tableHead}>
            <tr className={softwareEnvLayoutClass.headerRow}>
              <th className={softwareEnvLayoutClass.toolHeader}>
                {t("settings.software_env.tool")}
              </th>
              <th className={softwareEnvLayoutClass.descriptionHeader}>
                {t("settings.software_env.description_col")}
              </th>
              <th className={softwareEnvLayoutClass.statusHeader}>
                {t("settings.software_env.status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => {
              const state = getInstallState(tool.id);
              const detail = status?.details?.[tool.id];
              return (
                <tr key={tool.id} className={softwareEnvLayoutClass.tableRow}>
                  <td className={softwareEnvLayoutClass.cell}>
                    <span className="inline-flex items-center gap-2 font-medium">
                      <tool.Icon className="size-5" />
                      {tool.name}
                    </span>
                  </td>
                  <td className={softwareEnvLayoutClass.descriptionCell}>{tool.description}</td>
                  <td className={softwareEnvLayoutClass.statusCell}>
                    {isStatusLoading ? (
                      <span className={softwareEnvLayoutClass.loadingLabel}>
                        <LoadingSpinner size="default" />
                        {t("settings.software_env.loading")}
                      </span>
                    ) : state === "installed" ? (
                      <div className={softwareEnvLayoutClass.installedStack}>
                        <span className={softwareEnvLayoutClass.installedLabel}>
                          <CheckCircle2 className="size-4 text-dls-accent" />
                          {detail?.bundled
                            ? t("settings.software_env.bundled")
                            : t("settings.software_env.installed")}
                        </span>
                        {detail?.version ? (
                          <span className="text-xs text-muted-foreground">
                            {detail.version}
                          </span>
                        ) : null}
                      </div>
                    ) : state === "installing" ? (
                      <div className={softwareEnvLayoutClass.installingStack}>
                        <span className={softwareEnvLayoutClass.installingLabel}>
                          <LoadingSpinner size="default" />
                          {installProgress?.message ?? t("settings.software_env.installing")}
                        </span>
                        <div className={softwareEnvLayoutClass.progressTrack}>
                          <div
                            className={softwareEnvLayoutClass.progressFill}
                            style={{ width: `${installProgress?.progress ?? 5}%` }}
                          />
                        </div>
                      </div>
                    ) : state === "error" ? (
                      <div className={softwareEnvLayoutClass.errorStack}>
                        <Button size="sm" variant="outline" onClick={() => handleInstall(tool.id)}>
                          {t("settings.software_env.retry")}
                        </Button>
                        <span className={softwareEnvLayoutClass.errorText}>{errorMsg[tool.id]}</span>
                      </div>
                    ) : isStatusError ? (
                      <span className={softwareEnvLayoutClass.errorText}>
                        {t("settings.software_env.status_unavailable")}
                      </span>
                    ) : tool.id === "opencode" ? (
                      <Button size="sm" variant="outline" onClick={() => handleInstall(tool.id)}>
                        {t("settings.software_env.install")}
                      </Button>
                    ) : (
                      <span className={softwareEnvLayoutClass.errorText}>
                        {t("settings.software_env.bundled_missing")}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </LayoutSection>
  );
}
