/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ExternalLink,
  Layers,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import {
  readOpencodeConfig,
  writeOpencodeConfig,
  type OpencodeConfigFile,
} from "@/app/lib/desktop";
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
import { cn } from "@/lib/utils";
import { ProviderReloadRequiredModal } from "@/react-app/design-system/modals/provider-reload-required-modal";
import { useReloadCoordinator } from "@/react-app/shell/reload-coordinator";

const MCP_HUB_URL = "https://github.com/modelcontextprotocol/servers";
const DEFAULT_EDITOR_DOC = `{\n  "mcpServers": {}\n}\n`;

type ViewMode = "list" | "config";

type CustomConnectorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceRoot?: string | null;
  onSaved?: () => void;
  /** When opening from Composer「配置」, jump straight to the JSON editor. */
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

export function CustomConnectorDialog(props: CustomConnectorDialogProps) {
  const reloadCoordinator = useReloadCoordinator();
  const [view, setView] = useState<ViewMode>("list");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadModalOpen, setReloadModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [configFile, setConfigFile] = useState<OpencodeConfigFile | null>(null);
  const [baseConfig, setBaseConfig] = useState<Record<string, unknown>>({});
  const [editorText, setEditorText] = useState(DEFAULT_EDITOR_DOC);
  const [dirty, setDirty] = useState(false);

  const loadConfig = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setError(t("plugins.custom_connector_desktop_only"));
      setConfigFile(null);
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
      setConfigFile(file);
      setBaseConfig(parsed);
      setEditorText(toEditorDocument(servers));
      setDirty(false);
    } catch {
      setError(t("plugins.custom_connector_load_failed"));
      setConfigFile(null);
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

  const configPath =
    configFile?.path?.trim() ||
    (isDesktopRuntime() ? "~/.config/opencode/opencode.json" : "—");

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
      setView("list");
      props.onSaved?.();
      await loadConfig();
      // Close editor shell, then show a dedicated reload dialog (avoid stacking
      // the corner toast at the same time).
      props.onOpenChange(false);
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
    } finally {
      setReloading(false);
    }
  };

  return (
    <>
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="flex max-h-[min(720px,90vh)] w-[min(640px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
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
              {view === "list" ? (
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
              ) : null}
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

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8">
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
                    className="mt-1"
                    onClick={() => setView("config")}
                  >
                    {t("plugins.custom_connector_configure_cta")}
                  </Button>
                </div>
              ) : (
                <ul className="space-y-2">
                  {filteredServers.map((entry) => (
                    <li
                      key={entry.name}
                      className="flex items-center justify-between gap-3 rounded-xl border border-dls-border bg-dls-surface px-3.5 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-dls-text">
                          {entry.name}
                        </div>
                        <div className="mt-0.5 text-xs text-dls-secondary">{entry.type}</div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setView("config")}
                      >
                        {t("plugins.custom_connector_configure_cta")}
                      </Button>
                    </li>
                  ))}
                </ul>
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
            <div className="shrink-0 border-b border-dls-border bg-dls-surface-muted px-5 py-2 text-xs text-dls-secondary">
              {t("plugins.custom_connector_config_path", { path: configPath })}
            </div>
            {error ? (
              <div className="px-5 pt-3">
                <NoticeBox tone="error" role="alert">
                  {error}
                </NoticeBox>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-hidden px-5 py-3">
              <div className="flex h-full min-h-[280px] overflow-hidden rounded-lg border border-dls-border bg-dls-surface">
                <div
                  aria-hidden
                  className="select-none border-r border-dls-border bg-dls-surface-muted px-2 py-3 text-right font-mono text-xs leading-6 text-dls-secondary/70"
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
  // Match store header chrome for「我安装的」(outline sm + rounded-md), keep +.
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("gap-1.5 rounded-md mac:titlebar-no-drag", props.className)}
      onClick={props.onClick}
    >
      <Plus className="size-3.5" aria-hidden />
      {t("plugins.custom_connector")}
    </Button>
  );
}
