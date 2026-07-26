/** @jsxImportSource react */
import { ChevronDown, FileUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  OnMyAgentCommandItem,
  OnMyAgentServerClient,
  OnMyAgentSkillItem,
} from "../../../app/lib/onmyagent-server";
import type { SkillCard, SlashCommandOption } from "../../../app/types";
import { t } from "../../../i18n";
import { MenuRowButton } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SkillGlyphIcon } from "../../design-system/skill-glyph-icon";

/** Local merge (same rules as session slash menu) — keep messaging free of session imports. */
function mergeSlashCommandsWithSkills(
  cmds: SlashCommandOption[],
  skillCards: SkillCard[],
): { commands: SlashCommandOption[]; skillsForState: SkillCard[] | null } {
  const byName = new Map<string, SlashCommandOption>();
  for (const skill of skillCards) {
    const name = String(skill.name ?? "").trim();
    if (!name) continue;
    byName.set(name, {
      id: `skill:${name}`,
      name,
      description: skill.description ? String(skill.description) : undefined,
      source: "skill",
    });
  }
  for (const cmd of cmds) {
    const name = String(cmd.name ?? "").trim();
    if (!name) continue;
    byName.set(name, cmd);
  }
  return {
    commands: Array.from(byName.values()),
    skillsForState: skillCards.length ? skillCards : null,
  };
}

export function appendAutomationPromptText(prompt: string, text: string) {
  const trimmed = prompt.trimEnd();
  return trimmed ? `${trimmed}\n${text}` : text;
}

export function automationInboxFileReference(workspaceRoot: string, relativePath: string) {
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  const path = relativePath.replace(/^[\\/]+/, "");
  return `@${root}/.opencode/onmyagent/inbox/${path}`;
}

/**
 * Slash skill/command becomes the executable automation head
 * (`parseAutomationPromptCommand`). Existing free text is kept as arguments.
 */
export function applyAutomationToolSelection(
  prompt: string,
  selection:
    | { kind: "command"; name: string }
    | { kind: "skill"; name: string }
    | { kind: "plugin"; instruction: string }
    | { kind: "connector"; instruction: string },
) {
  if (selection.kind === "command" || selection.kind === "skill") {
    const body = prompt.replace(/^\s*\/\S+\s*/, "").trim();
    return body ? `/${selection.name} ${body}` : `/${selection.name} `;
  }
  return appendAutomationPromptText(prompt, selection.instruction);
}

/** Same catalog as session composer Skills (+ menu / slash): OC commands + skills. */
export function buildAutomationSkillCatalog(input: {
  openCodeCommands: Array<{
    id?: string;
    name: string;
    description?: string;
    source?: string;
  }>;
  skills: Array<{ name: string; description?: string; path?: string }>;
  markdownCommands?: Array<{ name: string; description?: string }>;
}): Array<{ name: string; description?: string; path?: string }> {
  const ocCmds: SlashCommandOption[] = input.openCodeCommands
    .filter((item) => item.source !== "mcp")
    .map((item): SlashCommandOption => ({
      id: item.id ?? `cmd:${item.name}`,
      name: String(item.name ?? "").trim(),
      description: item.description ? String(item.description) : undefined,
      source:
        item.source === "skill" || item.source === "command"
          ? item.source
          : "command",
    }))
    .filter((item) => item.name);

  const mdCmds: SlashCommandOption[] = (input.markdownCommands ?? [])
    .map((item) => ({
      id: `cmd:${item.name}`,
      name: String(item.name ?? "").trim(),
      description: item.description ? String(item.description) : undefined,
      source: "command" as const,
    }))
    .filter((item) => item.name);

  const skillCards: SkillCard[] = input.skills
    .map((item) => ({
      name: String(item.name ?? "").trim(),
      description: item.description ? String(item.description) : undefined,
      path:
        "path" in item && typeof item.path === "string" && item.path
          ? item.path
          : `skill:${String(item.name ?? "").trim()}`,
    }))
    .filter((item) => item.name);

  const merged = mergeSlashCommandsWithSkills(
    [...mdCmds, ...ocCmds],
    skillCards,
  );

  return merged.commands
    .map((item) => ({
      name: item.name,
      description: item.description,
      path:
        item.source === "skill"
          ? `skill:${item.name}`
          : item.id ?? `cmd:${item.name}`,
    }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}

/**
 * Simple skills chip — same pattern as model / access-permission chrome
 * (icon + label + chevron, single-column list). Not the dual-pane + tool menu.
 */
export function AutomationPromptTools(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  listOpenCodeCommands?: () => Promise<
    Array<{ id?: string; name: string; description?: string; source?: string }>
  >;
  listSkills?: () => Promise<
    Array<{ name: string; description?: string; path?: string }>
  >;
  /** Kept for call-site compatibility; plugins/connectors are not in this simple UI. */
  listMcp?: () => Promise<{
    servers: Array<{ name?: string; id?: string }>;
  }>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<
    Array<{ name: string; description?: string; path?: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !props.workspaceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [ocResult, skillResult, mdResult] = await Promise.allSettled([
          props.listOpenCodeCommands
            ? props.listOpenCodeCommands()
            : Promise.resolve(
                [] as Array<{
                  id?: string;
                  name: string;
                  description?: string;
                  source?: string;
                }>,
              ),
          props.listSkills
            ? props.listSkills()
            : props.client
              ? props.client
                  .listSkills(props.workspaceId, { includeGlobal: true })
                  .then((result) => result.items)
              : Promise.resolve([] as OnMyAgentSkillItem[]),
          props.client
            ? props.client
                .listCommands(props.workspaceId)
                .then((result) => result.items)
            : Promise.resolve([] as OnMyAgentCommandItem[]),
        ]);
        if (cancelled) return;

        const openCodeCommands =
          ocResult.status === "fulfilled" && Array.isArray(ocResult.value)
            ? ocResult.value
            : [];
        const skillItems =
          skillResult.status === "fulfilled" && Array.isArray(skillResult.value)
            ? skillResult.value
            : [];
        const markdownCommands =
          mdResult.status === "fulfilled" && Array.isArray(mdResult.value)
            ? mdResult.value
            : [];

        setSkills(
          buildAutomationSkillCatalog({
            openCodeCommands,
            skills: skillItems,
            markdownCommands,
          }),
        );
      } catch (cause: unknown) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : t("automation.tools_load_failed"),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    props.client,
    props.listOpenCodeCommands,
    props.listSkills,
    props.workspaceId,
  ]);

  const selectSkill = (name: string) => {
    props.onPromptChange(
      applyAutomationToolSelection(props.prompt, {
        kind: "skill",
        name,
      }),
    );
    setOpen(false);
  };

  const uploadFiles = async (files: File[]) => {
    const client = props.client;
    if (!client || !props.workspaceId || !props.workspaceRoot || files.length === 0)
      return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await Promise.all(
        files.map((file) => client.uploadInbox(props.workspaceId, file)),
      );
      const references = uploaded.map((item) =>
        automationInboxFileReference(props.workspaceRoot, item.path),
      );
      props.onPromptChange(
        appendAutomationPromptText(props.prompt, references.join("\n")),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("automation.file_upload_failed"),
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-0.5">
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
              size="sm"
              // Match model / access-permission chips: h-8 text-sm + chevron.
              className="h-8 max-w-28 shrink-0 gap-1.5 rounded-lg px-2 text-sm font-normal leading-none text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
              title={t("automation.tool_skills")}
              aria-label={t("automation.tool_skills")}
              aria-expanded={open}
              aria-haspopup="menu"
            >
              <SkillGlyphIcon className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{t("automation.tool_skills")}</span>
              <ChevronDown className="size-3.5 shrink-0 opacity-70" />
            </Button>
          }
        />
        <PopoverContent
          align="start"
          side="top"
          sideOffset={8}
          className="w-64 max-h-56 gap-0 overflow-hidden border border-dls-border bg-dls-surface-solid p-1 text-dls-text"
        >
          <div className="max-h-52 overflow-y-auto">
            {loading ? (
              <div className="flex min-h-16 items-center justify-center text-dls-secondary">
                <LoadingSpinner className="size-4" />
              </div>
            ) : error ? (
              <div className="p-2 text-sm text-dls-status-danger-fg">{error}</div>
            ) : skills.length === 0 ? (
              <div className="p-2 text-sm text-dls-secondary">
                {t("automation.tools_empty")}
              </div>
            ) : (
              <div className="grid gap-0.5">
                {skills.map((item) => (
                  <MenuRowButton
                    key={item.path ?? item.name}
                    type="button"
                    align="start"
                    density="compact"
                    onClick={() => selectSkill(item.name)}
                  >
                    <span className="min-w-0 overflow-hidden text-left">
                      <span className="block truncate text-sm font-medium text-dls-text">
                        {item.name}
                      </span>
                      {item.description ? (
                        <span className="mt-0.5 block truncate text-xs text-dls-secondary">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </MenuRowButton>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
        disabled={!props.client || uploading}
        title={
          uploading ? t("automation.file_uploading") : t("automation.tool_files")
        }
        aria-label={
          uploading ? t("automation.file_uploading") : t("automation.tool_files")
        }
        onClick={() => fileInputRef.current?.click()}
      >
        {uploading ? (
          <LoadingSpinner className="size-3.5" />
        ) : (
          <FileUp className="size-3.5" />
        )}
      </Button>
    </div>
  );
}
