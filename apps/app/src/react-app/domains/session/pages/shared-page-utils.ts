/**
 * Expert和Assistant页面的共享工具函数
 * 提取重复逻辑，减少代码冗余
 */

import type { ExpertPackageListEntry } from "../../../../app/lib/desktop";
import type { ExpertMarketplaceEntry } from "../expert-marketplace/types";
import {
  expertMarketplaceCategoryLabel,
  normalizeExpertMarketplaceCategoryId,
} from "../expert-marketplace/categories";
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
  store.setDraft(sessionId, nextDraft);
  store.setMentions(sessionId, { ...mentions, [path]: "file" });
  return true;
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
