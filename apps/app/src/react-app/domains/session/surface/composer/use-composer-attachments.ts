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
import { MAX_ATTACHMENT_LABEL } from "./composer-helpers";

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
      // Keep title short (reason first) so long native filenames do not hide the limit.
      onNotice({
        title: t("composer.file_exceeds_limit_title"),
        description:
          oversizeNames.length === 1
            ? t("composer.file_exceeds_limit_detail", {
                name: formatOversizeAttachmentName(
                  oversizeNames[0] ?? "",
                  t("composer.file_kind"),
                ),
                max: MAX_ATTACHMENT_LABEL,
              })
            : t("composer.file_exceeds_limit_multi", {
                count: oversizeNames.length,
                max: MAX_ATTACHMENT_LABEL,
              }),
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

  // Appshot uses Electron desktopCapturer in the desktop shell.
  const canCaptureAppshot = isAppshotCaptureSupported();

  const captureAppshot = useCallback(async () => {
    if (!inputRef.current.attachmentsEnabled || !canCaptureAppshot) return;
    inputRef.current.setToolMenuOpen(false);
    try {
      await attachAppshot(await desktopBridge.captureComputerUseAppshot());
    } catch (error) {
      const platform = detectClientPlatform();
      const raw = error instanceof Error ? error.message : "";
      const permissionLike =
        /screen recording|permission|APPSHOT_|black image|empty image/i.test(raw);
      let title = t("composer.appshot_failed");
      if (permissionLike) {
        title = t("composer.appshot_permission");
      } else if (raw && raw.length > 0 && raw.length <= 180) {
        title = raw;
      } else if (platform === "windows") {
        title = t("composer.appshot_unsupported_windows");
      } else if (platform === "linux") {
        title = t("composer.appshot_unsupported_linux");
      }
      inputRef.current.onNotice({ title, tone: "warning" });
    }
  }, [attachAppshot, canCaptureAppshot]);

  useEffect(() => {
    if (!canCaptureAppshot) return;
    const subscribe = window.__ONMYAGENT_ELECTRON__?.computerUse?.onAppshot;
    if (!subscribe) return;
    return subscribe((payload) => {
      const root = inputRef.current.rootRef.current;
      // Do NOT use offsetParent: fixed/sticky roots report null while still on screen.
      if (!root?.isConnected) return;
      if (root.getClientRects().length === 0) return;
      void attachAppshot(payload);
    });
  }, [attachAppshot, canCaptureAppshot]);

  // Settings / in-window keymap + menu all funnel here so attach is consistent.
  useEffect(() => {
    if (!canCaptureAppshot) return;
    const onKeymapSnapshot = () => {
      void captureAppshot();
    };
    window.addEventListener("onmyagent:keymap:app-snapshot", onKeymapSnapshot);
    return () => {
      window.removeEventListener(
        "onmyagent:keymap:app-snapshot",
        onKeymapSnapshot,
      );
    };
  }, [canCaptureAppshot, captureAppshot]);

  return {
    addAttachments,
    addSelectedMentionFiles,
    attachAppshot,
    captureAppshot,
    canCaptureAppshot,
  };
}
