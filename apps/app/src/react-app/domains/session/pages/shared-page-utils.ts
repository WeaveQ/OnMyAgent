/**
 * Expert和Assistant页面的共享工具函数
 * 提取重复逻辑，减少代码冗余
 */

import type { ExpertPackageListEntry } from "../../../../app/lib/desktop";
import type { ExpertMarketplaceEntry } from "@/react-app/domains/plugins";
import {
  expertMarketplaceCategoryLabel,
  normalizeExpertMarketplaceCategoryId,
} from "@/react-app/domains/plugins";
import {
  isCollectibleArtifactTarget,
  isUserFacingLocalPreviewTarget,
  type OpenTarget,
} from "../artifacts/open-target";
import { encodeComposerMentionValue } from "../surface/composer/mention-encoding";
import {
  getComposerDraft,
  getComposerMentions,
  useComposerStateStore,
} from "../surface/composer-state-store";
import { dispatchComposerTemplate } from "../surface/composer/capability-template";

/**
 * 判断专家包是否可见（过滤掉.expert-plugin目录）
 */
export function isVisibleExpertPackageEntry(entry: ExpertPackageListEntry): boolean {
  const values = [entry.packageName, entry.displayName, entry.packagePath];
  return values.every((value) => !value.split(/[\\/]/).includes(".expert-plugin"));
}

/**
 * 将专家包条目转换为市场专家格式
 */
export function packageEntryToMarketplaceExpert(
  entry: ExpertPackageListEntry,
): ExpertMarketplaceEntry {
  const categoryId = normalizeExpertMarketplaceCategoryId(entry.categoryId);
  return {
    ...entry,
    categoryId,
    categoryIds: categoryId === "all" ? [] : [categoryId],
    categoryLabel: expertMarketplaceCategoryLabel(categoryId),
    categoryLabels:
      categoryId === "all" ? [] : [expertMarketplaceCategoryLabel(categoryId)],
  };
}

/**
 * 判断目标是否可追踪（用于accessible targets）
 */
export function isTrackableAccessibleTarget(target: OpenTarget) {
  return (
    isCollectibleArtifactTarget(target) || isUserFacingLocalPreviewTarget(target)
  );
}

/**
 * 在新任务创建后设置composer draft
 * 使用多次调用确保draft被正确设置
 */
export function setComposerDraftAfterNewTask(workspaceId: string, draft: string) {
  const sessionId = `draft:${workspaceId}`;
  const apply = () => {
    useComposerStateStore.getState().setDraft(sessionId, draft);
  };
  apply();
  window.setTimeout(apply, 0);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(apply);
  });
}

/**
 * Insert a workspace file as an `@` mention into the active session composer
 * so the user can keep chatting about it ("添加到任务 / 添加到会话").
 */
export function appendComposerFileMention(
  sessionId: string,
  relativePath: string,
): boolean {
  const path = relativePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!sessionId.trim() || !path) return false;
  const store = useComposerStateStore.getState();
  const draft = getComposerDraft(store, sessionId);
  const mentions = getComposerMentions(store, sessionId);
  const token = encodeComposerMentionValue(path);
  const nextDraft = /@([^\s@]*)$/u.test(draft)
    ? draft.replace(/@([^\s@]*)$/u, `@${token} `)
    : `${draft}${draft.length > 0 && !/\s$/u.test(draft) ? " " : ""}@${token} `;
  // Mentions map first, then draft — SyncPlugin needs the kind when the
  // draft string lands so `@token` becomes a file chip, not plain text.
  store.setMentions(sessionId, { ...mentions, [path]: "file" });
  store.setDraft(sessionId, nextDraft);
  return true;
}

/**
 * WP3: @mention a file and append a short agent instruction so the user can
 * send immediately (Ask Agent about this file).
 * Mentions map + draft are applied with retries so Lexical SyncPlugin sees both.
 */
export function seedComposerFileAgentTask(
  sessionId: string,
  relativePath: string,
  instruction: string,
): boolean {
  const path = relativePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!sessionId.trim() || !path) return false;
  const text = String(instruction ?? "").trim();
  const token = encodeComposerMentionValue(path);
  const draft = text ? `@${token} ${text}` : `@${token} `;

  const apply = () => {
    const store = useComposerStateStore.getState();
    const mentions = getComposerMentions(store, sessionId);
    store.setMentions(sessionId, { ...mentions, [path]: "file" });
    store.setDraft(sessionId, draft);
  };
  apply();
  // Retries so Lexical SyncPlugin sees mentions+draft after navigation/openChat.
  // Guard for non-browser (unit tests).
  if (typeof window !== "undefined") {
    window.setTimeout(apply, 0);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(apply);
    });
  }
  return true;
}

type FilesToast = (input: {
  tone: "success" | "error" | "warning" | "info";
  title: string;
  description?: string | null;
  dismissLabel?: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}) => void;

/** Shared Files-page handlers for add-to-task / ask-agent / edit-error / toast. */
export function createWorkspaceFilesAgentHandlers(input: {
  sessionId: string;
  openRail: () => void;
  showToast: FilesToast;
  buildInstruction: (input: { fileName: string; preview?: string }) => string;
  t: (key: string) => string;
}) {
  const { sessionId, openRail, showToast, buildInstruction, t } = input;
  return {
    onToast: showToast,
    onAddToTask: (relativePath: string) => {
      if (!appendComposerFileMention(sessionId, relativePath)) return;
      openRail();
      showToast({
        tone: "success",
        title: t("files.added_to_task_title"),
        description: t("files.added_to_task"),
        dismissLabel: t("common.dismiss"),
      });
    },
    onAskAgentAboutFile: ({
      path,
      name,
      preview,
    }: {
      path: string;
      name: string;
      preview: string;
    }) => {
      if (
        !seedComposerFileAgentTask(
          sessionId,
          path,
          buildInstruction({ fileName: name, preview }),
        )
      ) {
        return;
      }
      openRail();
      showToast({
        tone: "success",
        title: t("files.ask_agent_done_title"),
        description: t("files.ask_agent_done"),
        dismissLabel: t("common.dismiss"),
      });
    },
    onEditError: () =>
      showToast({
        tone: "error",
        title: t("files.edit_file_failed"),
        dismissLabel: t("common.dismiss"),
        durationMs: 0,
      }),
  };
}

export function setExpertComposerDraftAfterNewTask(
  workspaceId: string,
  agentId: string,
  draft: string,
) {
  const sessionId = `draft:${workspaceId}:${agentId}`;
  const apply = () => {
    useComposerStateStore.getState().setDraft(sessionId, draft);
  };
  apply();
  window.setTimeout(apply, 0);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(apply);
  });
}

export function setComposerTemplateAfterNavigation(
  sessionId: string,
  template: string,
) {
  useComposerStateStore.getState().setDraft(sessionId, template);
  window.setTimeout(() => {
    dispatchComposerTemplate(template, sessionId);
  }, 0);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      dispatchComposerTemplate(template, sessionId);
    });
  });
}

export function setExpertComposerTemplateAfterNewTask(
  workspaceId: string,
  agentId: string,
  template: string,
) {
  setComposerTemplateAfterNavigation(
    `draft:${workspaceId}:${agentId}`,
    template,
  );
}
