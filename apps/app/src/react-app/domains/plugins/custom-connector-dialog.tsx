/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  ExternalLink,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { KoboyoIcon } from "@/react-app/design-system/koboyo-icon";
import { KOBOYO_BADGE_PLUS } from "@/react-app/design-system/koboyo-product-icons";

import {
  readOpencodeConfig,
  writeOpencodeConfig,
  type OpencodeConfigFile,
} from "@/app/lib/desktop";
import { createClient, unwrap } from "@/app/lib/opencode";
import type { McpStatus, McpStatusMap } from "@/app/types";
import { isDesktopRuntime } from "@/app/utils";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NoticeBox } from "@/components/ui/notice-box";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ProviderReloadRequiredModal } from "@/react-app/design-system/modals/provider-reload-required-modal";
import { useServer } from "@/react-app/kernel/server-provider";
import { useReloadCoordinator } from "@/react-app/shell";

const MCP_HUB_URL = "https://cloud.tencent.com/developer/mcp";
const DEFAULT_EDITOR_DOC = `{\n  "mcpServers": {}\n}\n`;

type ViewMode = "list" | "config";

type CustomConnectorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceRoot?: string | null;
  onSaved?: () => void;
  /** When opening from Composer configure, jump straight to the JSON editor. */
  initialView?: ViewMode;
};

function stripJsonc(raw: string): string {
  // Best-effort strip of // and /* */ comments for JSONC opencode configs.
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function parseConfigObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(stripJsonc(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function extractMcpServers(config: Record<string, unknown>): Record<string, unknown> {
  const mcpServers = config.mcpServers;
  if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)) {
    return mcpServers as Record<string, unknown>;
  }
  const mcp = config.mcp;
  if (mcp && typeof mcp === "object" && !Array.isArray(mcp)) {
    return mcp as Record<string, unknown>;
  }
  return {};
}

function toEditorDocument(servers: Record<string, unknown>): string {
  return `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
}

function serverEntries(servers: Record<string, unknown>) {
  return Object.entries(servers).map(([name, value]) => {
    const record =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const type =
      typeof record.type === "string"
        ? record.type
        : typeof record.command === "string"
          ? "stdio"
          : typeof record.url === "string"
            ? "remote"
            : "mcp";
    return { name, type };
  });
}

function serverTypeLabel(type: string): string {
  switch (type) {
    case "stdio":
    case "local":
      return t("plugins.custom_connector_type_local");
    case "remote":
    case "sse":
    case "http":
    case "streamable-http":
    case "streamableHttp":
      return t("plugins.custom_connector_type_remote");
    default:
      return t("plugins.custom_connector_type_tool");
  }
}

function serverAvatarInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "M";
  return trimmed.slice(0, 1).toUpperCase();
}

function avatarToneClass(name: string): string {
  const tones = [
    "bg-rose-500",
    "bg-sky-500",
    "bg-violet-500",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-orange-500",
  ] as const;
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash + name.charCodeAt(i) * (i + 1)) % tones.length;
  }
  return tones[hash] ?? tones[0];
}

function statusOf(statuses: McpStatusMap, name: string): McpStatus | undefined {
  return statuses[name];
}

function isConnected(status: McpStatus | undefined): boolean {
  return status?.status === "connected";
}

function isFailed(status: McpStatus | undefined): boolean {
  return status?.status === "failed" || status?.status === "needs_client_registration";
}

function statusErrorText(status: McpStatus | undefined): string | null {
  if (!status) return null;
  if (status.status === "failed") return status.error?.trim() || t("mcp.connect_failed");
  if (status.status === "needs_client_registration") {
    return status.error?.trim() || t("mcp.auth.client_registration_required");
  }
  if (status.status === "needs_auth") return t("mcp.friendly_status_needs_signin");
  return null;
}

function statusDotClass(status: McpStatus | undefined): string {
  if (isConnected(status)) return "bg-emerald-500";
  if (isFailed(status) || status?.status === "needs_auth") return "bg-rose-500";
  if (status?.status === "disabled") return "bg-dls-secondary/40";
  return "bg-amber-400";
}

export function CustomConnectorDialog(props: CustomConnectorDialogProps) {
  const reloadCoordinator = useReloadCoordinator();
  // GlobalSDKProvider is not mounted in the app shell; use the active server
  // URL + createClient (same path as session/settings) for MCP connect/status.
  const server = useServer();
  const [view, setView] = useState<ViewMode>("list");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadModalOpen, setReloadModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [baseConfig, setBaseConfig] = useState<Record<string, unknown>>({});
  const [editorText, setEditorText] = useState(DEFAULT_EDITOR_DOC);
  const [dirty, setDirty] = useState(false);
  const [mcpStatuses, setMcpStatuses] = useState<McpStatusMap>({});
  const [statusBusy, setStatusBusy] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copyDone, setCopyDone] = useState<string | null>(null);

  const directory = props.workspaceRoot?.trim() || undefined;

  const mcpClient = useMemo(() => {
    const baseUrl = server.url?.trim();
    if (!baseUrl) return null;
    try {
      return createClient(baseUrl, directory);
    } catch {
      return null;
    }
  }, [directory, server.url]);

  const refreshStatuses = useCallback(async () => {
    if (!isDesktopRuntime() || !mcpClient) return;
    try {
      const raw = unwrap(
        await mcpClient.mcp.status(
          directory ? { directory } : undefined,
        ),
      ) as McpStatusMap;
      setMcpStatuses(raw && typeof raw === "object" ? raw : {});
    } catch {
      // Status is best-effort; list still shows configured servers.
    }
  }, [directory, mcpClient]);

  const loadConfig = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setError(t("plugins.custom_connector_desktop_only"));
      setBaseConfig({});
      setEditorText(DEFAULT_EDITOR_DOC);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Bridge IPC return is loosely typed; assert the desktop contract shape.
      const file = (await readOpencodeConfig(
        "global",
        props.workspaceRoot?.trim() || "",
      )) as OpencodeConfigFile;
      const parsed = parseConfigObject(file.content);
      const servers = extractMcpServers(parsed);
      setBaseConfig(parsed);
      setEditorText(toEditorDocument(servers));
      setDirty(false);
    } catch {
      setError(t("plugins.custom_connector_load_failed"));
      setBaseConfig({});
      setEditorText(DEFAULT_EDITOR_DOC);
    } finally {
      setLoading(false);
    }
  }, [props.workspaceRoot]);

  useEffect(() => {
    if (!props.open) return;
    setView(props.initialView ?? "list");
    setQuery("");
    setError(null);
    void loadConfig();
  }, [props.open, props.initialView, loadConfig]);

  useEffect(() => {
    if (!props.open || view !== "list") return;
    void refreshStatuses();
    const timer = window.setInterval(() => {
      void refreshStatuses();
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [props.open, view, refreshStatuses]);

  const servers = useMemo(() => {
    try {
      const doc = JSON.parse(stripJsonc(editorText)) as Record<string, unknown>;
      return extractMcpServers(doc);
    } catch {
      return extractMcpServers(baseConfig);
    }
  }, [baseConfig, editorText]);

  const filteredServers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const entries = serverEntries(servers);
    if (!q) return entries;
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(q) || entry.type.toLowerCase().includes(q),
    );
  }, [query, servers]);

  const statusSummary = useMemo(() => {
    let enabled = 0;
    let failed = 0;
    for (const entry of filteredServers) {
      const status = statusOf(mcpStatuses, entry.name);
      if (isConnected(status)) enabled += 1;
      if (isFailed(status) || status?.status === "needs_auth") failed += 1;
    }
    return { enabled, failed };
  }, [filteredServers, mcpStatuses]);

  const setBusy = (name: string, busy: boolean) => {
    setStatusBusy((prev) => ({ ...prev, [name]: busy }));
  };

  const persistServers = async (nextServers: Record<string, unknown>) => {
    const nextConfig: Record<string, unknown> = { ...baseConfig, mcp: nextServers };
    delete nextConfig.mcpServers;
    const content = `${JSON.stringify(nextConfig, null, 2)}\n`;
    const writeResult = (await writeOpencodeConfig(
      "global",
      props.workspaceRoot?.trim() || "",
      content,
    )) as { ok?: boolean; stderr?: string; stdout?: string };
    if (writeResult && writeResult.ok === false) {
      throw new Error(writeResult.stderr || writeResult.stdout || "write failed");
    }
    setBaseConfig(nextConfig);
    setEditorText(toEditorDocument(nextServers));
    setDirty(false);
  };

  const handleReconnect = async (name: string) => {
    if (!mcpClient) return;
    setBusy(name, true);
    setExpanded((prev) => ({ ...prev, [name]: true }));
    try {
      // Ensure config marks the server enabled before reconnecting.
      const current = servers[name];
      if (current && typeof current === "object" && !Array.isArray(current)) {
        const record = current as Record<string, unknown>;
        if (record.enabled === false) {
          await persistServers({
            ...servers,
            [name]: { ...record, enabled: true },
          });
        }
      }
      // Best-effort disconnect so a stuck/failed session can be re-established.
      try {
        await mcpClient.mcp.disconnect({
          name,
          ...(directory ? { directory } : {}),
        });
      } catch {
        // ignore — already disconnected / never connected
      }
      unwrap(
        await mcpClient.mcp.connect({
          name,
          ...(directory ? { directory } : {}),
        }),
      );
      await refreshStatuses();
    } catch {
      await refreshStatuses();
    } finally {
      setBusy(name, false);
    }
  };

  const handleToggle = async (name: string, enabled: boolean) => {
    if (!mcpClient) return;
    setBusy(name, true);
    try {
      // Keep config.enabled in sync when present.
      const nextServers = { ...servers };
      const current = nextServers[name];
      if (current && typeof current === "object" && !Array.isArray(current)) {
        nextServers[name] = { ...(current as Record<string, unknown>), enabled };
        await persistServers(nextServers);
      }
      if (enabled) {
        unwrap(
          await mcpClient.mcp.connect({
            name,
            ...(directory ? { directory } : {}),
          }),
        );
      } else {
        try {
          await mcpClient.mcp.disconnect({
            name,
            ...(directory ? { directory } : {}),
          });
        } catch {
          // ignore — already disconnected
        }
      }
      await refreshStatuses();
    } catch {
      await refreshStatuses();
      if (enabled) {
        setExpanded((prev) => ({ ...prev, [name]: true }));
      }
    } finally {
      setBusy(name, false);
    }
  };

  const handleRemove = async (name: string) => {
    setBusy(name, true);
    try {
      if (mcpClient) {
        try {
          await mcpClient.mcp.disconnect({
            name,
            ...(directory ? { directory } : {}),
          });
        } catch {
          // disconnect is best-effort when already failed
        }
      }
      const nextServers = { ...servers };
      delete nextServers[name];
      await persistServers(nextServers);
      props.onSaved?.();
      await refreshStatuses();
    } catch {
      setError(t("mcp.remove_failed"));
    } finally {
      setBusy(name, false);
    }
  };

  const handleCopyError = async (name: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyDone(name);
      window.setTimeout(() => setCopyDone((cur) => (cur === name ? null : cur)), 1_500);
    } catch {
      // ignore clipboard failures
    }
  };

  const handleSave = async () => {
    if (!isDesktopRuntime()) {
      setError(t("plugins.custom_connector_desktop_only"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const doc = JSON.parse(stripJsonc(editorText)) as Record<string, unknown>;
      const nextServers = extractMcpServers(doc);
      // OpenCode config uses `mcp`; keep WorkBuddy-style mcpServers in the editor only.
      const nextConfig: Record<string, unknown> = { ...baseConfig, mcp: nextServers };
      delete nextConfig.mcpServers;
      const content = `${JSON.stringify(nextConfig, null, 2)}\n`;
      const writeResult = (await writeOpencodeConfig(
        "global",
        props.workspaceRoot?.trim() || "",
        content,
      )) as { ok?: boolean; stderr?: string; stdout?: string };
      if (writeResult && writeResult.ok === false) {
        throw new Error(writeResult.stderr || writeResult.stdout || "write failed");
      }
      setBaseConfig(nextConfig);
      setEditorText(toEditorDocument(nextServers));
      setDirty(false);
      // Stay on the management list so "我的 MCP / 连接器" shows saved entries.
      setView("list");
      props.onSaved?.();
      await loadConfig();
      // Keep this dialog open on the list; reload is a separate modal on top.
      setReloadModalOpen(true);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError(t("plugins.custom_connector_invalid_json"));
      } else {
        setError(t("plugins.custom_connector_save_failed"));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReloadEngine = async () => {
    if (reloading) return;
    setReloading(true);
    try {
      await reloadCoordinator.reloadWorkspaceEngine();
      setReloadModalOpen(false);
      await loadConfig();
      await refreshStatuses();
    } finally {
      setReloading(false);
    }
  };

  return (
    <>
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className={cn(
          // Fixed shell height so list and config/edit views don't jump.
          "flex h-[min(640px,90vh)] max-h-[min(640px,90vh)]",
          "w-[min(640px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl",
        )}
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 border-b border-dls-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-dls-surface-muted text-dls-text">
                <Layers className="size-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold text-dls-text">
                  {t("plugins.custom_connector_title")}
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-xs text-dls-secondary">
                  {t("plugins.custom_connector_subtitle")}
                </DialogDescription>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {/* Configure CTA lives in empty state / list section — avoid duplicate header chip. */}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => props.onOpenChange(false)}
                aria-label={t("common.close")}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {view === "list" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-dls-border px-5 py-3">
              <InputGroup controlSize="sm" radius="md" tone="surface" className="min-w-0 flex-1">
                <InputGroupAddon align="inline-start">
                  <Search className="size-3.5" />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder={t("plugins.custom_connector_search")}
                  className="text-sm"
                />
              </InputGroup>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => {
                  window.open(MCP_HUB_URL, "_blank", "noopener,noreferrer");
                }}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                {t("plugins.custom_connector_hub")}
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {loading ? (
                <div className="flex min-h-40 items-center justify-center">
                  <LoadingSpinner />
                </div>
              ) : error && filteredServers.length === 0 ? (
                <NoticeBox tone="error" role="alert">
                  {error}
                </NoticeBox>
              ) : filteredServers.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                  <div className="flex flex-col items-center gap-1 text-dls-secondary/50">
                    <Layers className="size-10" strokeWidth={1.25} aria-hidden />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-dls-text">
                      {t("plugins.custom_connector_empty_title")}
                    </div>
                    <p className="text-xs text-dls-secondary">
                      {t("plugins.custom_connector_empty_desc")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 gap-1.5"
                    onClick={() => setView("config")}
                  >
                    <Sparkles className="size-3.5" aria-hidden />
                    {t("plugins.custom_connector_configure")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 px-0.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-sm font-medium text-dls-text">
                        {t("plugins.custom_connector_mine")}
                      </span>
                      <span
                        className={cn(
                          "inline-flex h-5 min-w-5 items-center justify-center rounded-full",
                          "bg-dls-surface-muted px-1.5 text-2xs font-medium text-dls-secondary",
                        )}
                      >
                        {filteredServers.length}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-dls-secondary">
                        <span>
                          {t("plugins.custom_connector_summary_enabled", {
                            count: statusSummary.enabled,
                          })}
                        </span>
                        {statusSummary.failed > 0 ? (
                          <>
                            <span className="mx-1 text-dls-secondary/60">·</span>
                            <span className="text-rose-400">
                              {t("plugins.custom_connector_summary_failed", {
                                count: statusSummary.failed,
                              })}
                            </span>
                          </>
                        ) : null}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setView("config")}
                      >
                        <Sparkles className="size-3.5" aria-hidden />
                        {t("plugins.custom_connector_configure")}
                      </Button>
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {filteredServers.map((entry) => {
                      const status = statusOf(mcpStatuses, entry.name);
                      const errorText = statusErrorText(status);
                      const failed = isFailed(status) || status?.status === "needs_auth";
                      // Default-open failed rows (like the reference UI); user can collapse.
                      const open =
                        expanded[entry.name] !== undefined
                          ? Boolean(expanded[entry.name])
                          : failed;
                      const busy = Boolean(statusBusy[entry.name]);
                      // Switch reflects live connection; failed/auth rows show off.
                      const toggledOn = isConnected(status);
                      return (
                        <li
                          key={entry.name}
                          className="rounded-xl border border-dls-border bg-dls-surface px-3 py-2.5"
                        >
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                              onClick={() =>
                                setExpanded((prev) => ({
                                  ...prev,
                                  [entry.name]: !open,
                                }))
                              }
                            >
                              <ChevronDown
                                className={cn(
                                  "size-4 shrink-0 text-dls-secondary transition-transform",
                                  open ? "rotate-0" : "-rotate-90",
                                )}
                                aria-hidden
                              />
                              <div
                                className={cn(
                                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                                  "text-sm font-semibold text-white",
                                  avatarToneClass(entry.name),
                                )}
                                aria-hidden
                              >
                                {serverAvatarInitial(entry.name)}
                              </div>
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate text-sm font-medium text-dls-text">
                                    {entry.name}
                                  </span>
                                  <span
                                    className={cn(
                                      "size-1.5 shrink-0 rounded-full",
                                      busy ? "bg-amber-400 animate-pulse" : statusDotClass(status),
                                    )}
                                    aria-hidden
                                  />
                                </div>
                                <div className="mt-0.5 text-xs text-dls-secondary">
                                  {serverTypeLabel(entry.type)}
                                </div>
                              </div>
                            </button>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                disabled={busy}
                                aria-label={t("plugins.custom_connector_reconnect")}
                                onClick={() => void handleReconnect(entry.name)}
                              >
                                <RefreshCw
                                  className={cn("size-3.5", busy && "animate-spin")}
                                />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                disabled={busy}
                                aria-label={t("plugins.remove")}
                                onClick={() => void handleRemove(entry.name)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                              <Switch
                                size="sm"
                                checked={toggledOn}
                                disabled={busy}
                                onCheckedChange={(next) =>
                                  void handleToggle(entry.name, next)
                                }
                                aria-label={entry.name}
                              />
                            </div>
                          </div>
                          {open && (errorText || busy) ? (
                            <div className="mt-2.5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2.5">
                              <p className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-rose-300">
                                {busy
                                  ? t("plugins.custom_connector_reconnecting")
                                  : errorText}
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-dls-secondary">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 hover:text-dls-text disabled:opacity-50"
                                  disabled={busy}
                                  onClick={() => void handleReconnect(entry.name)}
                                >
                                  <RefreshCw
                                    className={cn("size-3", busy && "animate-spin")}
                                    aria-hidden
                                  />
                                  {busy
                                    ? t("plugins.custom_connector_reconnecting")
                                    : t("plugins.custom_connector_reconnect")}
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 hover:text-dls-text"
                                  onClick={() =>
                                    window.open(
                                      MCP_HUB_URL,
                                      "_blank",
                                      "noopener,noreferrer",
                                    )
                                  }
                                >
                                  <ExternalLink className="size-3" aria-hidden />
                                  {t("plugins.custom_connector_guide")}
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 hover:text-dls-text"
                                  disabled={!errorText}
                                  onClick={() => {
                                    if (errorText) {
                                      void handleCopyError(entry.name, errorText);
                                    }
                                  }}
                                >
                                  <Copy className="size-3" aria-hidden />
                                  {copyDone === entry.name
                                    ? t("mcp.auth.copied")
                                    : t("plugins.custom_connector_copy_log")}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-dls-border px-5 py-2.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1 text-dls-secondary"
                onClick={() => {
                  setView("list");
                  setError(null);
                  void loadConfig();
                }}
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                {t("plugins.custom_connector_back")}
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setView("list");
                    setError(null);
                    void loadConfig();
                  }}
                >
                  {t("plugins.custom_connector_cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={saving || !dirty}
                  onClick={() => void handleSave()}
                >
                  {saving ? <LoadingSpinner size="sm" /> : null}
                  {t("plugins.custom_connector_save")}
                </Button>
              </div>
            </div>
            {error ? (
              <div className="px-5 pt-3">
                <NoticeBox tone="error" role="alert">
                  {error}
                </NoticeBox>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-hidden px-5 py-3">
              <div className="flex h-full min-h-0 overflow-hidden rounded-lg border border-dls-border bg-dls-surface">
                <div
                  aria-hidden
                  className="select-none overflow-y-auto border-r border-dls-border bg-dls-surface-muted px-2 py-3 text-right font-mono text-xs leading-6 text-dls-secondary/70"
                >
                  {editorText.split("\n").map((_, index) => (
                    <div key={index}>{index + 1}</div>
                  ))}
                </div>
                <textarea
                  value={editorText}
                  onChange={(event) => {
                    setEditorText(event.currentTarget.value);
                    setDirty(true);
                    setError(null);
                  }}
                  spellCheck={false}
                  className={cn(
                    "min-h-0 w-full flex-1 resize-none bg-transparent px-3 py-3 font-mono text-xs leading-6 text-dls-text outline-none",
                  )}
                  aria-label={t("plugins.custom_connector_configure")}
                />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    <ProviderReloadRequiredModal
      open={reloadModalOpen}
      busy={reloading}
      title={t("plugins.custom_connector_reload_title")}
      description={t("plugins.custom_connector_reload_desc")}
      reloadLabel={t("plugins.custom_connector_reload_now")}
      dismissLabel={t("app.reload_later")}
      onReload={() => {
        void handleReloadEngine();
      }}
      onDismiss={() => {
        setReloadModalOpen(false);
        // Defer to the global toast if the user chooses later.
        reloadCoordinator.markReloadRequired("mcp", {
          type: "mcp",
          name: "custom-connector",
          action: "updated",
        });
      }}
    />
    </>
  );
}

export function CustomConnectorEntryButton(props: {
  onClick: () => void;
  className?: string;
}) {
  // Match store header chrome; Koboyo badge-plus instead of bare Lucide +.
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("gap-1.5 rounded-lg mac:titlebar-no-drag", props.className)}
      onClick={props.onClick}
    >
      <KoboyoIcon
        src={KOBOYO_BADGE_PLUS}
        size={14}
        className="text-dls-secondary bg-current"
      />
      {t("plugins.custom_connector")}
    </Button>
  );
}
