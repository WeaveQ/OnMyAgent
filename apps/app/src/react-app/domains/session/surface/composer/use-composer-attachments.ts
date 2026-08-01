/**
 * Attachment intake, appshot capture, and mention multi-file attach wiring.
 * Mechanical extract from ReactSessionComposer — no behavior changes.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { desktopBridge } from "../../../../../app/lib/desktop";
import { t } from "../../../../../i18n";
import type { ReactComposerNotice as ReactComposerNoticeData } from "./notice";
import {
  fileFromAppshotPayload,
  formatAttachmentSuccessDisplayName,
  formatOversizeAttachmentName,
  parseAppshotPayload,
  processAttachmentFiles,
} from "./attachments";
import {
  detectClientPlatform,
  isAppshotCaptureSupported,
} from "./appshot";

export type UseComposerAttachmentsInput = {
  attachmentsEnabled: boolean;
  attachmentsDisabledReason: string | null;
  onAttachFiles: (files: File[]) => void;
  onNotice: (notice: ReactComposerNoticeData) => void;
  loadWorkspaceFiles: (paths: string[]) => Promise<File[]>;
  rootRef: RefObject<HTMLDivElement | null>;
  draftRef: RefObject<string>;
  onDraftChange: (value: string) => void;
  setMentionOpen: (open: boolean) => void;
  setToolMenuOpen: (open: boolean) => void;
  mentionAddSelectedFiles: (
    loadWorkspaceFiles: (paths: string[]) => Promise<File[]>,
    addAttachments: (files: File[]) => Promise<number>,
  ) => Promise<boolean | number>;
};

export function useComposerAttachments(input: UseComposerAttachmentsInput) {
  // Keep latest callbacks without re-binding addAttachments every render.
  const inputRef = useRef(input);
  inputRef.current = input;

  const addAttachments = useCallback(async (inputFiles: File[]): Promise<number> => {
    const {
      attachmentsEnabled,
      attachmentsDisabledReason,
      onAttachFiles,
      onNotice,
    } = inputRef.current;
    if (!inputFiles.length) return 0;
    if (!attachmentsEnabled) {
      onNotice({
        title: attachmentsDisabledReason ?? t("composer.attachments_unavailable"),
        tone: "warning",
      });
      return 0;
    }

    const { accepted, oversizeNames } = await processAttachmentFiles(inputFiles);

    if (accepted.length) {
      onAttachFiles(accepted);
      // Compact composer notice — never dump long/corrupted native names into the card.
      if (accepted.length === 1) {
        const displayName = formatAttachmentSuccessDisplayName(
          accepted[0]?.name?.trim() || "",
        );
        onNotice({
          title: t("composer.upload_success_title"),
          description: displayName
            ? t("composer.uploaded_single_file_short", { name: displayName })
            : null,
          tone: "success",
        });
      } else {
        onNotice({
          title: t("composer.upload_success_title"),
          description: t("composer.uploaded_multiple_files", { count: accepted.length }),
          tone: "success",
        });
      }
    }

    if (oversizeNames.length) {
      onNotice({
        title:
          oversizeNames.length === 1
            ? t("composer.file_exceeds_limit", {
                name: formatOversizeAttachmentName(
                  oversizeNames[0] ?? "",
                  t("composer.file_kind"),
                ),
              })
            : `${oversizeNames.length} files exceed the 8MB limit.`,
        tone: "warning",
      });
    }
    return accepted.length;
  }, []);

  const addSelectedMentionFiles = useCallback(async () => {
    const {
      attachmentsEnabled,
      attachmentsDisabledReason,
      onNotice,
      loadWorkspaceFiles,
      mentionAddSelectedFiles,
      draftRef,
      onDraftChange,
      setMentionOpen,
    } = inputRef.current;
    if (!attachmentsEnabled) {
      onNotice({
        title: attachmentsDisabledReason ?? t("composer.attachments_unavailable"),
        tone: "warning",
      });
      return;
    }
    const added = await mentionAddSelectedFiles(loadWorkspaceFiles, addAttachments);
    if (!added) return;
    onDraftChange(draftRef.current.replace(/@([^\s@]*)$/, ""));
    setMentionOpen(false);
  }, [addAttachments]);

  const attachAppshot = useCallback(
    async (payload: unknown) => {
      const parsed = parseAppshotPayload(payload);
      if (!parsed) return;
      // Guard against native bugs that stringify Swift String as JoinedSequence debug text.
      await addAttachments([fileFromAppshotPayload(parsed)]);
      // Dedicated short notice — no filename dump (attachment chip already shows it).
      inputRef.current.onNotice({
        title: t("composer.appshot_success"),
        tone: "success",
      });
    },
    [addAttachments],
  );

  // Appshot requires the macOS Computer Use helper; hide the action elsewhere.
  const canCaptureAppshot = isAppshotCaptureSupported();

  const captureAppshot = useCallback(async () => {
    if (!inputRef.current.attachmentsEnabled || !canCaptureAppshot) return;
    inputRef.current.setToolMenuOpen(false);
    try {
      await attachAppshot(await desktopBridge.captureComputerUseAppshot());
    } catch (error) {
      const platform = detectClientPlatform();
      const fallback =
        platform === "windows"
          ? t("composer.appshot_unsupported_windows")
          : platform === "linux"
            ? t("composer.appshot_unsupported_linux")
            : t("composer.appshot_failed");
      inputRef.current.onNotice({
        title: error instanceof Error ? error.message : fallback,
        tone: "warning",
      });
    }
  }, [attachAppshot, canCaptureAppshot]);

  useEffect(() => {
    if (!canCaptureAppshot) return;
    const subscribe = window.__ONMYAGENT_ELECTRON__?.computerUse?.onAppshot;
    if (!subscribe) return;
    return subscribe((payload) => {
      const root = inputRef.current.rootRef.current;
      if (!root || root.offsetParent === null) return;
      void attachAppshot(payload);
    });
  });

  return {
    addAttachments,
    addSelectedMentionFiles,
    attachAppshot,
    captureAppshot,
    canCaptureAppshot,
  };
}
