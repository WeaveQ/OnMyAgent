/** @jsxImportSource react */
import { Braces, ChevronRight, FileUp, Package, Plug, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";

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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SkillGlyphIcon } from "../../design-system/skill-glyph-icon";

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

export function appendAutomationPromptText(prompt: string, text: string) {
  const trimmed = prompt.trimEnd();
  return trimmed ? `${trimmed}\n${text}` : text;
}

export function automationInboxFileReference(workspaceRoot: string, relativePath: string) {
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  const path = relativePath.replace(/^[\\/]+/, "");
  return `@${root}/.opencode/onmyagent/inbox/${path}`;
}

export function applyAutomationToolSelection(
  prompt: string,
  selection:
    | { kind: "command"; name: string }
    | { kind: "skill"; name: string }
    | { kind: "plugin"; instruction: string }
    | { kind: "connector"; instruction: string },
) {
  if (selection.kind === "command" || selection.kind === "skill") {
    return `/${selection.name} `;
  }
  return appendAutomationPromptText(prompt, selection.instruction);
}

export function AutomationPromptTools(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  prompt: string;
  onPromptChange: (prompt: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<ToolSection>("commands");
  const [data, setData] = useState<ToolData>(emptyToolData);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !props.client || !props.workspaceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const request = section === "commands"
      ? props.client.listCommands(props.workspaceId).then((result) => result.items)
      : section === "skills"
        ? props.client.listSkills(props.workspaceId, { includeGlobal: true }).then((result) => result.items)
        : section === "plugins"
          ? props.client.listPlugins(props.workspaceId, { includeGlobal: true }).then((result) => result.items)
          : props.client.listMcp(props.workspaceId).then((result) => result.items);
    void request.then((items) => {
      if (cancelled) return;
      setData((current) => ({ ...current, [section]: items }));
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : t("automation.tools_load_failed"));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, props.client, props.workspaceId, section]);

  const selectSlashCommand = (name: string) => {
    props.onPromptChange(applyAutomationToolSelection(props.prompt, { kind: section === "skills" ? "skill" : "command", name }));
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
      const references = uploaded.map((item) => automationInboxFileReference(props.workspaceRoot, item.path));
      props.onPromptChange(appendAutomationPromptText(props.prompt, references.join("\n")));
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("automation.file_upload_failed"));
    } finally {
      setUploading(false);
    }
  };

  const sections: Array<{
    id: ToolSection;
    label: string;
    icon: ComponentType<{ className?: string }>;
  }> = [
    { id: "commands", label: t("automation.tool_commands"), icon: Braces },
    { id: "skills", label: t("automation.tool_skills"), icon: SkillGlyphIcon },
    { id: "plugins", label: t("automation.tool_plugins"), icon: Package },
    { id: "connectors", label: t("automation.tool_connectors"), icon: Plug },
  ];
  const items = data[section];

  return (
    <div>
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
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
              title={t("composer.quick_actions")}
              aria-label={t("composer.quick_actions")}
            >
              <Plus className={`size-4 transition-transform duration-200 ${open ? "rotate-45" : "rotate-0"}`} />
            </Button>
          }
        />
        <PopoverContent
          align="start"
          side="top"
          sideOffset={12}
          className="flex min-h-48 w-[min(36rem,calc(100vw-5rem))] flex-row gap-0 overflow-hidden border border-dls-border bg-dls-surface p-0 text-dls-text"
        >
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
                  props.onPromptChange(applyAutomationToolSelection(props.prompt, {
                    kind: "plugin",
                    instruction: t("automation.use_plugin_prompt", { name: item.spec }),
                  }));
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
                  props.onPromptChange(applyAutomationToolSelection(props.prompt, {
                    kind: "connector",
                    instruction: t("automation.use_connector_prompt", { name: item.name }),
                  }));
                  setOpen(false);
                }}
              >
                <span className="truncate text-sm font-medium text-dls-text">{item.name}</span>
              </MenuRowButton>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
