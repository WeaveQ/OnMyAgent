/** @jsxImportSource react */
/**
 * Composer attachment/mention/paste/upload handlers for SessionSurface.
 * Extracted from session-surface.tsx (mechanical split).
 */
import { useCallback, useEffect } from "react";
import type { CloudImportedPlugin } from "../../../../app/cloud/import-state";
import { readWorkspaceCloudImports } from "../../../../app/cloud/import-state";
import { createClient, unwrap } from "../../../../app/lib/opencode";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import type {
  ComposerAttachment,
  ComposerDraft,
  McpServerEntry,
  McpStatusMap,
  SkillCard,
} from "../../../../app/types";
import { t } from "../../../../i18n";
import { recordInspectorEvent } from "../../../shell";
import { encodeComposerMentionValue } from "./composer/mention-encoding";
import type { ReactComposerNotice } from "./composer/notice";
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
  mentions: Record<string, "agent" | "file">;
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
    mentions: Record<string, "agent" | "file">,
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
    const oversized = files.filter((file) => file.size > 25 * 1024 * 1024);
    const accepted = files.filter((file) => file.size <= 25 * 1024 * 1024);
    if (oversized.length) {
      setNotice({
        title:
          oversized.length === 1
            ? `${oversized[0]?.name ?? "File"} is too large`
            : `${oversized.length} files are too large`,
        description: t("session.files_over_25mb_skipped"),
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

  const handleInsertMention = (kind: "agent" | "file", value: string) => {
    setComposerDraft(
      sessionId,
      draft.replace(/@([^\s@]*)$/, `@${encodeComposerMentionValue(value)} `),
    );
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
    const next = (response.items ?? []).map(
      (skill) =>
        ({
          name: skill.name,
          path: skill.path,
          description: skill.description,
          trigger: skill.trigger,
        }) satisfies SkillCard,
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
      const results = await Promise.all(
        input.map((file) => client.uploadInbox(workspaceId, file)),
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
    listSkills,
    listMcp,
    listImportedPlugins,
    handleUploadInboxFiles,
  };
}
