/** @jsxImportSource react */
import { Braces, ChevronRight, FileUp, Package, Plug, Plus, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  OnMyAgentCommandItem,
  OnMyAgentMcpItem,
  OnMyAgentPluginItem,
  OnMyAgentServerClient,
  OnMyAgentSkillItem,
} from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import { MenuRowButton } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

type ToolSection = "commands" | "skills" | "plugins" | "connectors";

type ToolData = {
  commands: OnMyAgentCommandItem[];
  skills: OnMyAgentSkillItem[];
  plugins: OnMyAgentPluginItem[];
  connectors: OnMyAgentMcpItem[];
};

const emptyToolData: ToolData = {
  commands: [],
  skills: [],
  plugins: [],
  connectors: [],
};

function appendPromptText(prompt: string, text: string) {
  const trimmed = prompt.trimEnd();
  return trimmed ? `${trimmed}\n${text}` : text;
}

function inboxFilePath(workspaceRoot: string, relativePath: string) {
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  const path = relativePath.replace(/^[\\/]+/, "");
  return `${root}/.opencode/onmyagent/inbox/${path}`;
}

export function AutomationPromptTools(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  prompt: string;
  onPromptChange: (prompt: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<ToolSection>("commands");
  const [data, setData] = useState<ToolData>(emptyToolData);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !props.client || !props.workspaceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      props.client.listCommands(props.workspaceId),
      props.client.listSkills(props.workspaceId, { includeGlobal: true }),
      props.client.listPlugins(props.workspaceId, { includeGlobal: true }),
      props.client.listMcp(props.workspaceId),
    ]).then(([commands, skills, plugins, connectors]) => {
      if (cancelled) return;
      setData({
        commands: commands.items,
        skills: skills.items,
        plugins: plugins.items,
        connectors: connectors.items,
      });
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : t("automation.tools_load_failed"));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, props.client, props.workspaceId]);

  const selectSlashCommand = (name: string) => {
    props.onPromptChange(`/${name} `);
    setOpen(false);
  };

  const uploadFiles = async (files: File[]) => {
    const client = props.client;
    if (!client || !props.workspaceId || !props.workspaceRoot || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await Promise.all(
        files.map((file) => client.uploadInbox(props.workspaceId, file)),
      );
      const references = uploaded.map((item) => `@${inboxFilePath(props.workspaceRoot, item.path)}`);
      props.onPromptChange(appendPromptText(props.prompt, references.join("\n")));
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("automation.file_upload_failed"));
    } finally {
      setUploading(false);
    }
  };

  const sections: Array<{ id: ToolSection; label: string; icon: typeof Braces }> = [
    { id: "commands", label: t("automation.tool_commands"), icon: Braces },
    { id: "skills", label: t("automation.tool_skills"), icon: Zap },
    { id: "plugins", label: t("automation.tool_plugins"), icon: Package },
    { id: "connectors", label: t("automation.tool_connectors"), icon: Plug },
  ];
  const items = data[section];

  return (
    <div ref={menuRef} className="relative">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void uploadFiles(files);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t("composer.quick_actions")}
        aria-label={t("composer.quick_actions")}
      >
        <Plus className={`size-4 transition-transform duration-200 ${open ? "rotate-45" : "rotate-0"}`} />
      </Button>
      {open ? (
        <div className="absolute bottom-full left-0 z-40 mb-3 flex min-h-48 w-[min(36rem,calc(100vw-5rem))] overflow-hidden rounded-xl border border-dls-border bg-dls-surface shadow-lg">
          <div className="w-40 shrink-0 border-r border-dls-border p-2">
            <MenuRowButton
              type="button"
              align="center"
              className="mb-1 gap-2"
              disabled={!props.client || uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? <LoadingSpinner className="size-3.5" /> : <FileUp className="size-3.5 text-dls-secondary" />}
              <span className="truncate">{uploading ? t("automation.file_uploading") : t("automation.tool_files")}</span>
            </MenuRowButton>
            {sections.map(({ id, label, icon: Icon }) => (
              <MenuRowButton
                key={id}
                type="button"
                align="center"
                active={section === id}
                className="mb-1 justify-between gap-2"
                onMouseEnter={() => setSection(id)}
                onFocus={() => setSection(id)}
                onClick={() => setSection(id)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="size-3.5 shrink-0 text-dls-secondary" />
                  <span className="truncate">{label}</span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-dls-secondary" />
              </MenuRowButton>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex min-h-40 items-center justify-center text-dls-secondary">
                <LoadingSpinner className="size-4" />
              </div>
            ) : error ? (
              <div className="p-3 text-sm text-dls-status-danger-fg">{error}</div>
            ) : items.length === 0 ? (
              <div className="p-3 text-sm text-dls-secondary">{t("automation.tools_empty")}</div>
            ) : section === "commands" ? data.commands.map((item) => (
              <MenuRowButton key={item.name} type="button" align="start" onClick={() => selectSlashCommand(item.name)}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-dls-text">/{item.name}</span>
                  {item.description ? <span className="mt-1 block line-clamp-2 text-xs text-dls-secondary">{item.description}</span> : null}
                </span>
              </MenuRowButton>
            )) : section === "skills" ? data.skills.map((item) => (
              <MenuRowButton key={item.path} type="button" align="start" onClick={() => selectSlashCommand(item.name)}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-dls-text">/{item.name}</span>
                  <span className="mt-1 block line-clamp-2 text-xs text-dls-secondary">{item.description}</span>
                </span>
              </MenuRowButton>
            )) : section === "plugins" ? data.plugins.map((item) => (
              <MenuRowButton
                key={`${item.scope}-${item.spec}`}
                type="button"
                align="start"
                onClick={() => {
                  props.onPromptChange(appendPromptText(props.prompt, t("automation.use_plugin_prompt", { name: item.spec })));
                  setOpen(false);
                }}
              >
                <span className="truncate text-sm font-medium text-dls-text">{item.spec}</span>
              </MenuRowButton>
            )) : data.connectors.map((item) => (
              <MenuRowButton
                key={item.name}
                type="button"
                align="start"
                onClick={() => {
                  props.onPromptChange(appendPromptText(props.prompt, t("automation.use_connector_prompt", { name: item.name })));
                  setOpen(false);
                }}
              >
                <span className="truncate text-sm font-medium text-dls-text">{item.name}</span>
              </MenuRowButton>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
