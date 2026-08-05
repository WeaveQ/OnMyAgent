/** @jsxImportSource react */
/**
 * Composer attachment/mention/paste/upload handlers for SessionSurface.
 * Extracted from session-surface.tsx (mechanical split).
 */
import { useCallback, useEffect } from "react";
import type { CloudImportedPlugin } from "../../../../app/cloud/import-state";
import { readWorkspaceCloudImports } from "../../../../app/cloud/import-state";
import { listLocalSkills } from "../../../../app/lib/desktop";
import type { LocalSkillCard } from "../../../../app/lib/desktop-types";
import { createClient, unwrap } from "../../../../app/lib/opencode";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import type {
  ComposerAttachment,
  ComposerDraft,
  ComposerMentionKind,
  McpServerEntry,
  McpStatusMap,
  SkillCard,
} from "../../../../app/types";
import { isDesktopRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import { recordInspectorEvent } from "../../../shell";
import { encodeComposerMentionValue } from "./composer/mention-encoding";
import { dispatchComposerTemplate } from "./composer/capability-template";
import type { ReactComposerNotice } from "./composer/notice";
import { formatOversizeAttachmentName } from "./composer/attachments";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_LABEL,
} from "./composer/composer-helpers";
import { createComposerAttachments } from "./session-surface-support";
import { waitForControl } from "./session-surface-hooks";

type OpencodeClient = ReturnType<typeof createClient>;

export type SessionSurfaceComposerHandlersInput = {
  sessionId: string;
  workspaceId: string;
  workspaceRoot: string;
  attachmentsEnabled?: boolean;
  attachmentsDisabledReason?: string | null;
  draft: string;
  attachments: ComposerAttachment[];
  mentions: Record<string, ComposerMentionKind>;
  pasteParts: Array<{
    id: string;
    label: string;
    text: string;
    lines: number;
  }>;
  setComposerDraft: (sessionId: string, draft: string) => void;
  setComposerAttachments: (sessionId: string, attachments: ComposerAttachment[]) => void;
  setComposerMentions: (
    sessionId: string,
    mentions: Record<string, ComposerMentionKind>,
  ) => void;
  setComposerPasteParts: (
    sessionId: string,
    parts: Array<{ id: string; label: string; text: string; lines: number }>,
  ) => void;
  setNotice: (notice: ReactComposerNotice | null) => void;
  setToolSkills: (skills: SkillCard[]) => void;
  setToolMcpServers: (servers: McpServerEntry[]) => void;
  setToolMcpStatuses: (statuses: McpStatusMap) => void;
  setToolMcpStatus: (status: string | null) => void;
  setToolImportedPlugins: (plugins: CloudImportedPlugin[]) => void;
  buildDraft: (text: string, attachments: ComposerAttachment[]) => ComposerDraft;
  onDraftChange: (draft: ComposerDraft) => void;
  client: OnMyAgentServerClient;
  opencodeClient: OpencodeClient;
};

/** Mechanical extract of SessionSurface composer side-handlers. */
export function useSessionSurfaceComposerHandlers(
  input: SessionSurfaceComposerHandlersInput,
) {
  const {
    sessionId,
    workspaceId,
    workspaceRoot,
    attachmentsEnabled,
    attachmentsDisabledReason,
    draft,
    attachments,
    mentions,
    pasteParts,
    setComposerDraft,
    setComposerAttachments,
    setComposerMentions,
    setComposerPasteParts,
    setNotice,
    setToolSkills,
    setToolMcpServers,
    setToolMcpStatuses,
    setToolMcpStatus,
    setToolImportedPlugins,
    buildDraft,
    onDraftChange,
    client,
    opencodeClient,
  } = input;

  const handleAttachFiles = (files: File[]) => {
    if (!attachmentsEnabled) {
      setNotice({
        title:
          attachmentsDisabledReason ?? t("session.attachments_unavailable"),
        tone: "warning",
      });
      return;
    }
    const maxBytes = MAX_ATTACHMENT_BYTES;
    const oversized = files.filter((file) => file.size > maxBytes);
    const accepted = files.filter((file) => file.size <= maxBytes);
    if (oversized.length) {
      setNotice({
        title: t("composer.file_exceeds_limit_title"),
        description:
          oversized.length === 1
            ? t("composer.file_exceeds_limit_detail", {
                name: formatOversizeAttachmentName(
                  oversized[0]?.name ?? "",
                  t("composer.file_kind"),
                ),
                max: MAX_ATTACHMENT_LABEL,
              })
            : t("composer.file_exceeds_limit_multi", {
                count: oversized.length,
                max: MAX_ATTACHMENT_LABEL,
              }),
        tone: "warning",
      });
    }
    if (!accepted.length) return;
    const next = createComposerAttachments(accepted);
    setComposerAttachments(sessionId, [...attachments, ...next]);
    // Success notice is owned by the composer (`addAttachments`) so long /
    // corrupted native filenames never land in the title.
  };

  const handleRemoveAttachment = (id: string) => {
    const target = attachments.find((item) => item.id === id);
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }
    setComposerAttachments(
      sessionId,
      attachments.filter((item) => item.id !== id),
    );
  };

  const handleInsertMention = (kind: ComposerMentionKind, value: string) => {
    const token = encodeComposerMentionValue(value);
    // Replace in-progress `@query` when picking from the mention menu; otherwise
    // append so "add to task" from My Files still inserts a usable chip.
    const nextDraft = /@([^\s@]*)$/u.test(draft)
      ? draft.replace(/@([^\s@]*)$/u, `@${token} `)
      : `${draft}${draft.length > 0 && !/\s$/u.test(draft) ? " " : ""}@${token} `;
    setComposerDraft(sessionId, nextDraft);
    setComposerMentions(sessionId, { ...mentions, [value]: kind });
  };

  const handlePasteText = (text: string) => {
    if (!text) return;
    const separator = draft && !draft.endsWith("\n") ? "\n" : "";
    setComposerDraft(sessionId, `${draft}${separator}${text}`);
  };

  const handleRevealPastedText = (id: string) => {
    const part = pasteParts.find((item) => item.id === id);
    if (!part) return;
    setNotice({
      title: `Pasted text · ${part.label}`,
      description: part.text.slice(0, 800),
      tone: "info",
    });
  };

  const handleExpandPastedText = (id: string) => {
    const part = pasteParts.find((item) => item.id === id);
    if (!part) return;
    setComposerDraft(
      sessionId,
      draft.replace(`[pasted text ${part.label}]`, part.text),
    );
    setComposerPasteParts(
      sessionId,
      pasteParts.filter((item) => item.id !== id),
    );
  };

  const handleRemovePastedText = (id: string) => {
    const target = pasteParts.find((item) => item.id === id);
    if (!target) return;
    setComposerDraft(
      sessionId,
      draft.replace(`[pasted text ${target.label}]`, ""),
    );
    setComposerPasteParts(
      sessionId,
      pasteParts.filter((item) => item.id !== id),
    );
  };

  const handleUnsupportedFileLinks = (links: string[]) => {
    if (!links.length) return;
    setComposerDraft(
      sessionId,
      `${draft}${draft && !draft.endsWith("\n") ? "\n" : ""}${links.join("\n")}`,
    );
  };

  const typeComposerText = useCallback(
    async (text: string) => {
      window.dispatchEvent(new Event("onmyagent:focusPrompt"));
      setComposerDraft(sessionId, text);
      await waitForControl(40);
    },
    [sessionId, setComposerDraft],
  );

  const typeComposerTemplate = useCallback(async (template: string) => {
    window.dispatchEvent(new Event("onmyagent:focusPrompt"));
    dispatchComposerTemplate(template);
    await waitForControl(40);
  }, []);

  useEffect(() => {
    const handleVoiceTranscript = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (
        !detail ||
        typeof detail !== "object" ||
        Array.isArray(detail) ||
        !("text" in detail) ||
        typeof detail.text !== "string"
      )
        return;
      const text = detail.text;
      void typeComposerText(text);
      onDraftChange(buildDraft(text, attachments));
      recordInspectorEvent("voice.transcript.applied", {
        workspaceId: workspaceId,
        sessionId: sessionId,
        length: text.length,
      });
    };
    window.addEventListener("onmyagent:voice-transcript", handleVoiceTranscript);
    return () =>
      window.removeEventListener(
        "onmyagent:voice-transcript",
        handleVoiceTranscript,
      );
  }, [
    attachments,
    buildDraft,
    onDraftChange,
    sessionId,
    workspaceId,
    typeComposerText,
  ]);

  const listSkills = async (): Promise<SkillCard[]> => {
    const response = await client.listSkills(workspaceId, {
      includeGlobal: true,
    });
    const byName = new Map<string, SkillCard>();
    for (const skill of response.items ?? []) {
      // Map server scopes onto SkillCard; "onmyagent" marks marketplace/global installs.
      const rawScope = skill.scope;
      const scope: SkillCard["scope"] =
        rawScope === "onmyagent"
          ? "onmyagent"
          : rawScope === "built-in"
            ? "builtin"
            : rawScope === "local" || rawScope === "project"
              ? "local"
              : rawScope === "global"
                ? "onmyagent"
                : undefined;
      const name = String(skill.name ?? "").trim();
      if (!name) continue;
      byName.set(name, {
        name,
        path: skill.path,
        description: skill.description,
        trigger: skill.trigger,
        scope,
      });
    }

    // Align with skills marketplace: desktop install/list uses profile dual-read
    // roots. Merge those so + menu sees marketplace installs even when server
    // list lags or only scanned a legacy path.
    if (isDesktopRuntime() && workspaceRoot.trim()) {
      try {
        const localRaw: unknown = await listLocalSkills(workspaceRoot.trim());
        const local = Array.isArray(localRaw)
          ? (localRaw as LocalSkillCard[])
          : [];
        for (const skill of local) {
          const name = String(skill.name ?? "").trim();
          if (!name) continue;
          const skillPath = String(skill.path ?? "").replaceAll("\\", "/");
          const isOnmyagentRoot =
            skillPath.includes("/.onmyagent/skills") ||
            skillPath.includes("/onmyagent/skills") ||
            /\/\.onmyagent\/profiles\/[^/]+\/config\/skills/.test(skillPath);
          if (!isOnmyagentRoot) continue;
          const existing = byName.get(name);
          if (existing?.scope === "onmyagent" || existing?.scope === "builtin") {
            continue;
          }
          byName.set(name, {
            name,
            path: skill.path,
            description:
              skill.descriptionZh ||
              skill.descriptionEn ||
              skill.description ||
              existing?.description,
            trigger: skill.trigger ?? existing?.trigger,
            scope: "onmyagent",
          });
        }
      } catch {
        // Desktop IPC unavailable (web / early boot) — server list only.
      }
    }

    const next = Array.from(byName.values()).sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
    setToolSkills(next);
    return next;
  };

  const listMcp = async (): Promise<{
    servers: McpServerEntry[];
    statuses: McpStatusMap;
    status: string | null;
  }> => {
    const response = await client.listMcp(workspaceId);
    const servers = (response.items ?? []).map(
      (entry) =>
        ({
          name: entry.name,
          config: entry.config as McpServerEntry["config"],
        }) satisfies McpServerEntry,
    );

    let statuses: McpStatusMap = {};
    try {
      if (workspaceRoot.trim()) {
        statuses = unwrap(
          await opencodeClient.mcp.status({
            directory: workspaceRoot.trim(),
          }),
        ) as McpStatusMap;
      }
    } catch {
      statuses = {};
    }

    const status = servers.length ? null : "No MCP servers loaded.";
    setToolMcpServers(servers);
    setToolMcpStatuses(statuses);
    setToolMcpStatus(status);
    return { servers, statuses, status };
  };

  const listImportedPlugins = async (): Promise<CloudImportedPlugin[]> => {
    const response = await client.getConfig(workspaceId);
    const plugins = Object.values(
      readWorkspaceCloudImports(response.onmyagent).plugins,
    ).sort((left, right) => left.name.localeCompare(right.name));
    setToolImportedPlugins(plugins);
    return plugins;
  };

  const handleUploadInboxFiles = async (
    files: File[],
    options?: { notify?: boolean },
  ) => {
    const input = files.filter(Boolean);
    if (!input.length) return;
    try {
      const { uploadUserFileToWorkspace } = await import(
        "../../workspace"
      );
      const results = await Promise.all(
        input.map((file) =>
          uploadUserFileToWorkspace(client, workspaceId, file),
        ),
      );
      if (options?.notify !== false) {
        const summary = results
          .map(
            (item) =>
              item.path.split("/").filter(Boolean).slice(-1)[0] ?? item.path,
          )
          .join(", ");
        setNotice({
          title:
            input.length === 1
              ? "Uploaded to the shared folder."
              : `Uploaded ${input.length} files to the shared folder.`,
          description: summary || undefined,
          tone: "success",
        });
      }
      return results;
    } catch (nextError) {
      setNotice({
        title:
          nextError instanceof Error
            ? nextError.message
            : "Shared folder upload failed",
        tone: "warning",
      });
      throw nextError;
    }
  };


  return {
    handleAttachFiles,
    handleRemoveAttachment,
    handleInsertMention,
    handlePasteText,
    handleRevealPastedText,
    handleExpandPastedText,
    handleRemovePastedText,
    handleUnsupportedFileLinks,
    typeComposerText,
    typeComposerTemplate,
    listSkills,
    listMcp,
    listImportedPlugins,
    handleUploadInboxFiles,
  };
}
