/** @jsxImportSource react */
/**
 * Memory settings — enable toggles, pending cards, local awareness files,
 * danger zone (reset style / handbook / clear memory).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  FolderOpen,
  Ghost,
  User,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { currentLocale, t } from "@/i18n";
import {
  formatRelativeTime,
  isElectronRuntime,
} from "../../../../app/utils";
import {
  listWorkMemoryAwarenessFiles,
  openWorkMemoryAwarenessFolder,
  writeWorkMemoryAwarenessFile,
} from "../../../../app/lib/desktop";
import type {
  ConversationMemoryItem,
  ConversationMemoryState,
} from "../../../kernel/local-provider";
import {
  acceptAllPendingMemory,
  acceptPendingMemory,
  clearGlobalWorkMemory,
  getWorkMemorySeed,
  parseProfileMemoryLine,
  prefsPatchFromAwarenessFile,
  rejectPendingMemory,
  selectGlobalMemoryItems,
  type MemoryProfileCategory,
  type UserProfileLabelMaps,
  type WorkMemorySeedFileName,
} from "../../shared";
import type { OnboardingProfile } from "../../../kernel/local-provider";
import type { ResponseToneId } from "../../../kernel/response-tone";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import {
  SettingsBlock,
  SettingsBlockRow,
  SettingsPageSection,
} from "../settings-section";
import { LayoutStack } from "../settings-layout";
import {
  AwarenessFileViewerModal,
  type AwarenessFileKind,
} from "./awareness-file-viewer-modal";

export type ConversationMemoryViewProps = {
  conversationMemory: ConversationMemoryState;
  onConversationMemoryChange: (next: ConversationMemoryState) => void;
  /** Reset Personal tone + custom instructions (prefs). */
  onResetCollaborationStyle?: () => void;
  onboardingProfile?: OnboardingProfile | null;
  responseTone?: ResponseToneId | string;
  customInstructions?: string;
  userProfileLabels?: UserProfileLabelMaps;
  /** After viewer saves file to disk, merge markdown back into prefs. */
  onApplyAwarenessFileToPrefs?: (
    patch: {
      onboardingProfile?: OnboardingProfile;
      responseTone?: ResponseToneId;
      customInstructions?: string;
      conversationMemory?: ConversationMemoryState;
    },
  ) => void;
};

type DangerAction = "style" | "handbook" | "memory" | null;

function categoryLabel(category: MemoryProfileCategory | null): string {
  switch (category) {
    case "instruction":
      return t("settings.memory_category_instruction");
    case "identity":
      return t("settings.memory_category_identity");
    case "career":
      return t("settings.memory_category_career");
    case "project":
      return t("settings.memory_category_project");
    case "preference":
      return t("settings.memory_category_preference");
    default:
      return t("settings.memory_conversation_source_manual");
  }
}

/** Pending-confirm card only (saved/short-term lists removed from settings UI). */
function PendingMemoryCard(props: {
  item: ConversationMemoryItem;
  onAccept: () => void;
  onReject: () => void;
}) {
  const parsed = parseProfileMemoryLine(props.item.text);
  const title = parsed.content || props.item.text;
  const sourceLabel =
    props.item.source === "manual"
      ? t("settings.memory_conversation_source_manual")
      : t("settings.memory_conversation_source_dialog");
  const scopeLabel = props.item.expertId
    ? t("settings.memory_conversation_expert_scope", {
        id: props.item.expertId,
      })
    : t("settings.memory_conversation_global_scope");

  return (
    <div className="rounded-xl border border-dls-border bg-dls-surface-muted/40 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-dls-text">
            {title}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-dls-secondary">
            <span className="rounded-md bg-dls-surface-muted px-1.5 py-0.5 text-dls-secondary">
              {sourceLabel}
            </span>
            <span>{categoryLabel(parsed.category)}</span>
            <span aria-hidden>·</span>
            <span>{scopeLabel}</span>
            {props.item.sessionId ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  {t("settings.memory_conversation_session_ref", {
                    id: props.item.sessionId.slice(0, 8),
                  })}
                </span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span>{t("settings.memory_conversation_pending_badge")}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-dls-secondary hover:text-dls-status-success-fg"
            onClick={props.onAccept}
            aria-label={t("settings.memory_conversation_pending_accept")}
            title={t("settings.memory_conversation_pending_accept")}
          >
            <Check className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-dls-secondary hover:text-dls-status-danger-fg"
            onClick={props.onReject}
            aria-label={t("settings.memory_conversation_pending_reject")}
            title={t("settings.memory_conversation_pending_reject")}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ConversationMemoryView(props: ConversationMemoryViewProps) {
  const {
    conversationMemory,
    onConversationMemoryChange,
    onResetCollaborationStyle,
    onboardingProfile,
    userProfileLabels,
    onApplyAwarenessFileToPrefs,
  } = props;
  const [awarenessPath, setAwarenessPath] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<
    Record<string, { size: number; mtimeMs: number; exists: boolean }>
  >({});
  const [openFolderBusy, setOpenFolderBusy] = useState(false);
  const [openFolderError, setOpenFolderError] = useState<string | null>(null);
  const [viewerFile, setViewerFile] = useState<AwarenessFileKind | null>(null);
  const [dangerConfirm, setDangerConfirm] = useState<DangerAction>(null);
  const [dangerBusy, setDangerBusy] = useState(false);
  const [dangerStatus, setDangerStatus] = useState<string | null>(null);
  const desktop = isElectronRuntime();

  const globalCount = useMemo(
    () => selectGlobalMemoryItems(conversationMemory.items).length,
    [conversationMemory.items],
  );

  const pendingItems = useMemo(
    () =>
      [...(conversationMemory.pending ?? [])].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    [conversationMemory.pending],
  );

  const onAcceptPending = useCallback(
    (id: string) => {
      onConversationMemoryChange(acceptPendingMemory(conversationMemory, id));
    },
    [conversationMemory, onConversationMemoryChange],
  );

  const onRejectPending = useCallback(
    (id: string) => {
      onConversationMemoryChange(rejectPendingMemory(conversationMemory, id));
    },
    [conversationMemory, onConversationMemoryChange],
  );

  const onAcceptAllPending = useCallback(() => {
    onConversationMemoryChange(acceptAllPendingMemory(conversationMemory));
  }, [conversationMemory, onConversationMemoryChange]);

  const refreshFileList = useCallback(async () => {
    if (!desktop) return;
    try {
      const listed = await listWorkMemoryAwarenessFiles();
      if (listed?.path) setAwarenessPath(listed.path);
      const next: Record<string, { size: number; mtimeMs: number; exists: boolean }> =
        {};
      for (const file of listed?.files ?? []) {
        next[file.name] = {
          size: file.size,
          mtimeMs: file.mtimeMs,
          exists: file.exists,
        };
      }
      setFileMeta(next);
    } catch {
      // ignore list errors in web / older desktop
    }
  }, [desktop]);

  useEffect(() => {
    void refreshFileList();
  }, [refreshFileList]);

  const openAwarenessFolder = useCallback(async () => {
    if (!desktop) {
      setOpenFolderError(t("settings.memory_open_folder_desktop_only"));
      return;
    }
    setOpenFolderBusy(true);
    setOpenFolderError(null);
    try {
      const path = await openWorkMemoryAwarenessFolder();
      setAwarenessPath(path);
      await refreshFileList();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error ?? "");
      // Main-process IPC list is fixed at Electron launch; HMR will not pick up new commands.
      if (/not declared|not implemented/i.test(raw)) {
        setOpenFolderError(t("settings.memory_open_folder_restart_required"));
      } else {
        setOpenFolderError(raw || t("settings.memory_open_folder_failed"));
      }
    } finally {
      setOpenFolderBusy(false);
    }
  }, [desktop, refreshFileList]);

  /** File path/size line — omit entirely when missing. */
  const formatFileMeta = (name: string): string | null => {
    const meta = fileMeta[name];
    if (!meta?.exists) return null;
    const sizeLabel =
      meta.size < 1024
        ? `${meta.size} B`
        : `${(meta.size / 1024).toFixed(1)} KB`;
    const timeLabel = meta.mtimeMs
      ? formatRelativeTime(meta.mtimeMs)
      : "";
    return [name, sizeLabel, timeLabel].filter(Boolean).join(" · ");
  };

  const renderFileMeta = (name: string) => {
    const label = formatFileMeta(name);
    if (!label) return null;
    return (
      <span className="block font-mono text-xs text-dls-secondary">{label}</span>
    );
  };

  const writeSeedFile = useCallback(
    async (name: WorkMemorySeedFileName): Promise<"ok" | "skip" | "error"> => {
      if (!desktop) return "skip";
      try {
        await writeWorkMemoryAwarenessFile({
          name,
          content: getWorkMemorySeed(currentLocale())[name],
        });
        return "ok";
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error ?? "");
        if (/not declared|not implemented/i.test(raw)) return "error";
        return "error";
      }
    },
    [desktop],
  );

  const runDangerAction = useCallback(
    async (action: Exclude<DangerAction, null>) => {
      setDangerBusy(true);
      setDangerStatus(null);
      try {
        if (action === "style") {
          onResetCollaborationStyle?.();
          const fileResult = await writeSeedFile("style.md");
          if (fileResult === "error") {
            setDangerStatus(t("settings.memory_danger_desktop_file_skipped"));
          } else {
            setDangerStatus(t("settings.memory_danger_done_style"));
          }
          await refreshFileList();
        } else if (action === "handbook") {
          const fileResult = await writeSeedFile("AGENTS.md");
          if (fileResult === "skip") {
            setDangerStatus(t("settings.memory_open_folder_desktop_only"));
          } else if (fileResult === "error") {
            setDangerStatus(t("settings.memory_danger_failed"));
          } else {
            setDangerStatus(t("settings.memory_danger_done_handbook"));
          }
          await refreshFileList();
        } else if (action === "memory") {
          onConversationMemoryChange(clearGlobalWorkMemory(conversationMemory));
          const memResult = await writeSeedFile("MEMORY.md");
          await writeSeedFile("pending.json");
          if (memResult === "error") {
            setDangerStatus(t("settings.memory_danger_desktop_file_skipped"));
          } else {
            setDangerStatus(t("settings.memory_danger_done_memory"));
          }
          await refreshFileList();
        }
      } catch {
        setDangerStatus(t("settings.memory_danger_failed"));
      } finally {
        setDangerBusy(false);
        setDangerConfirm(null);
      }
    },
    [
      conversationMemory,
      desktop,
      onConversationMemoryChange,
      onResetCollaborationStyle,
      refreshFileList,
      writeSeedFile,
    ],
  );

  const dangerConfirmCopy = useMemo(() => {
    switch (dangerConfirm) {
      case "style":
        return {
          title: t("settings.memory_danger_reset_style_confirm_title"),
          body: t("settings.memory_danger_reset_style_confirm_body"),
        };
      case "handbook":
        return {
          title: t("settings.memory_danger_reset_handbook_confirm_title"),
          body: t("settings.memory_danger_reset_handbook_confirm_body"),
        };
      case "memory":
        return {
          title: t("settings.memory_danger_clear_memory_confirm_title"),
          body: t("settings.memory_danger_clear_memory_confirm_body"),
        };
      default:
        return { title: "", body: "" };
    }
  }, [dangerConfirm]);

  return (
    <LayoutStack className="gap-y-8">
      {/* Master + auto-capture (auto write only when both on) */}
      <SettingsPageSection title={t("settings.memory_conversation_section")}>
        <SettingsBlock>
          <SettingsBlockRow
            align="start"
            title={t("settings.memory_conversation_toggle")}
            description={t("settings.memory_conversation_toggle_desc")}
            actions={
              <Switch
                checked={conversationMemory.enabled}
                onCheckedChange={(checked) =>
                  onConversationMemoryChange({
                    ...conversationMemory,
                    enabled: checked === true,
                    // Turning master off also stops auto-capture.
                    autoCapture:
                      checked === true
                        ? conversationMemory.autoCapture === true
                        : false,
                    pending: conversationMemory.pending ?? [],
                    shortTerm: conversationMemory.shortTerm ?? [],
                  })
                }
                aria-label={t("settings.memory_conversation_toggle")}
              />
            }
          />
          <SettingsBlockRow
            align="start"
            title={t("settings.memory_auto_capture_toggle")}
            description={t("settings.memory_auto_capture_toggle_desc")}
            actions={
              <Switch
                checked={
                  conversationMemory.enabled &&
                  conversationMemory.autoCapture === true
                }
                disabled={!conversationMemory.enabled}
                onCheckedChange={(checked) =>
                  onConversationMemoryChange({
                    ...conversationMemory,
                    autoCapture: checked === true,
                    pending: conversationMemory.pending ?? [],
                    shortTerm: conversationMemory.shortTerm ?? [],
                  })
                }
                aria-label={t("settings.memory_auto_capture_toggle")}
              />
            }
          />
        </SettingsBlock>
      </SettingsPageSection>

      {/* Legacy pending queue — only when non-empty */}
      {pendingItems.length > 0 ? (
        <SettingsPageSection
          title={t("settings.memory_conversation_pending_title")}
          description={t("settings.memory_conversation_pending_desc")}
        >
          <div className="mb-3 flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onAcceptAllPending}
            >
              <Check className="size-4" />
              {t("settings.memory_conversation_pending_accept_all")}
            </Button>
          </div>
          <div className="flex flex-col gap-2.5">
            {pendingItems.map((item) => (
              <PendingMemoryCard
                key={item.id}
                item={item}
                onAccept={() => onAcceptPending(item.id)}
                onReject={() => onRejectPending(item.id)}
              />
            ))}
          </div>
        </SettingsPageSection>
      ) : null}

      {/* Local files always visible — profile/style independent of memory toggle (B') */}
      <SettingsPageSection
        title={t("settings.memory_local_files_title")}
        description={t("settings.memory_local_files_desc")}
      >
        <SettingsBlock>
          <SettingsBlockRow
            align="start"
            title={t("settings.memory_local_storage_path")}
            description={
              <span className="font-mono text-xs break-all text-dls-secondary">
                {awarenessPath ?? t("settings.memory_local_storage_path_hint")}
              </span>
            }
            actions={
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={openFolderBusy}
                onClick={() => void openAwarenessFolder()}
              >
                <FolderOpen className="size-4" />
                {openFolderBusy
                  ? t("settings.memory_open_folder_busy")
                  : t("settings.memory_open_folder")}
              </Button>
            }
          />
          <SettingsBlockRow
            title={
              <span className="inline-flex items-center gap-2">
                <Ghost className="size-4 text-dls-secondary" aria-hidden />
                {t("settings.memory_row_style")}
              </span>
            }
            description={
              <span className="space-y-0.5">
                <span className="block text-sm text-dls-secondary">
                  {t("settings.memory_row_style_desc")}
                </span>
                {renderFileMeta("style.md")}
              </span>
            }
            actions={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-0.5 text-dls-secondary"
                onClick={() => setViewerFile("style.md")}
              >
                {t("settings.memory_file_view")}
                <ChevronRight className="size-4" />
              </Button>
            }
          />
          <SettingsBlockRow
            title={
              <span className="inline-flex items-center gap-2">
                <BookOpen className="size-4 text-dls-secondary" aria-hidden />
                {t("settings.memory_row_handbook")}
              </span>
            }
            description={
              <span className="space-y-0.5">
                <span className="block text-sm text-dls-secondary">
                  {t("settings.memory_row_handbook_desc")}
                </span>
                {renderFileMeta("AGENTS.md")}
              </span>
            }
            actions={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-0.5 text-dls-secondary"
                onClick={() => setViewerFile("AGENTS.md")}
              >
                {t("settings.memory_file_view")}
                <ChevronRight className="size-4" />
              </Button>
            }
          />
          <SettingsBlockRow
            title={
              <span className="inline-flex items-center gap-2">
                <User className="size-4 text-dls-secondary" aria-hidden />
                {t("settings.memory_row_user")}
              </span>
            }
            description={
              <span className="space-y-0.5">
                <span className="block text-sm text-dls-secondary">
                  {t("settings.memory_row_user_desc")}
                </span>
                {renderFileMeta("USER.md")}
              </span>
            }
            actions={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-0.5 text-dls-secondary"
                onClick={() => setViewerFile("USER.md")}
              >
                {t("settings.memory_file_view")}
                <ChevronRight className="size-4" />
              </Button>
            }
          />
          <SettingsBlockRow
            title={
              <span className="inline-flex items-center gap-2">
                <Brain className="size-4 text-dls-secondary" aria-hidden />
                {t("settings.memory_row_long_term")}
              </span>
            }
            description={
              <span className="space-y-0.5">
                <span className="block text-sm text-dls-secondary">
                  {t("settings.memory_local_file_memory_meta", {
                    count: globalCount,
                  })}
                </span>
                {renderFileMeta("MEMORY.md")}
              </span>
            }
            actions={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-0.5 text-dls-secondary"
                onClick={() => setViewerFile("MEMORY.md")}
              >
                {t("settings.memory_file_view")}
                <ChevronRight className="size-4" />
              </Button>
            }
          />
        </SettingsBlock>
        {openFolderError ? (
          <p className="mt-2 text-xs text-dls-status-danger-fg">
            {openFolderError}
          </p>
        ) : null}
      </SettingsPageSection>

      <AwarenessFileViewerModal
        open={viewerFile !== null}
        fileName={viewerFile}
        title={viewerFile ?? ""}
        description={
          awarenessPath && viewerFile
            ? `${awarenessPath.replace(/\/$/, "")}/${viewerFile}`
            : t("settings.memory_file_viewer_desc")
        }
        onClose={() => setViewerFile(null)}
        onSaved={() => void refreshFileList()}
        onApplyContentToPrefs={(fileName, content) => {
          if (!onApplyAwarenessFileToPrefs) return;
          if (
            fileName !== "USER.md" &&
            fileName !== "style.md" &&
            fileName !== "MEMORY.md"
          ) {
            return;
          }
          const patch = prefsPatchFromAwarenessFile(fileName, content, {
            profile: onboardingProfile,
            labels: userProfileLabels,
            conversationMemory,
          });
          if (patch) onApplyAwarenessFileToPrefs(patch);
        }}
      />

      {/* Danger zone — always available */}
      <SettingsPageSection
        title={
          <span className="text-dls-status-danger-fg">
            {t("settings.memory_danger_title")}
          </span>
        }
        description={t("settings.memory_danger_desc")}
      >
        <SettingsBlock className="border-dls-status-danger-border/50">
          <SettingsBlockRow
            align="start"
            title={t("settings.memory_danger_reset_style_title")}
            description={t("settings.memory_danger_reset_style_desc")}
            actions={
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={dangerBusy}
                onClick={() => setDangerConfirm("style")}
              >
                {t("settings.memory_danger_reset_style_action")}
              </Button>
            }
          />
          <SettingsBlockRow
            align="start"
            title={t("settings.memory_danger_reset_handbook_title")}
            description={t("settings.memory_danger_reset_handbook_desc")}
            actions={
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={dangerBusy}
                onClick={() => setDangerConfirm("handbook")}
              >
                {t("settings.memory_danger_reset_handbook_action")}
              </Button>
            }
          />
          <SettingsBlockRow
            align="start"
            title={t("settings.memory_danger_clear_memory_title")}
            description={t("settings.memory_danger_clear_memory_desc")}
            actions={
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={dangerBusy}
                onClick={() => setDangerConfirm("memory")}
              >
                {t("settings.memory_danger_clear_memory_action")}
              </Button>
            }
          />
        </SettingsBlock>
        {dangerStatus ? (
          <p className="mt-2 text-xs text-dls-secondary">{dangerStatus}</p>
        ) : null}
      </SettingsPageSection>

      <ConfirmModal
        open={dangerConfirm !== null}
        title={dangerConfirmCopy.title}
        message={dangerConfirmCopy.body}
        confirmLabel={
          dangerBusy
            ? t("settings.memory_danger_busy")
            : t("settings.memory_danger_confirm")
        }
        cancelLabel={t("settings.memory_danger_cancel")}
        variant="danger"
        onConfirm={() => {
          if (!dangerConfirm || dangerBusy) return;
          void runDangerAction(dangerConfirm);
        }}
        onCancel={() => {
          if (!dangerBusy) setDangerConfirm(null);
        }}
      />
    </LayoutStack>
  );
}
