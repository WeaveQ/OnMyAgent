/**
 * Pure layout flags for SessionSurface draft-home / expert-empty / home composer.
 * Keeps derivation out of the host return path.
 */
import { t } from "../../../../i18n";
import type { AssistantCategoryId } from "./personal-assistant-config";

export type SessionSurfaceLayoutModeInput = {
  personalAssistantHome?: boolean;
  draftOnly?: boolean;
  hasAgentContext: boolean;
  hasEffectiveAgent: boolean;
  renderedMessageCount: number;
  hasTranscriptContent: boolean;
  hasVisibleTranscriptError: boolean;
  activityIdle: boolean;
  assistantCategoryId: AssistantCategoryId;
  /** When set (office/code feature), draft workspace accessory can show. */
  assistantFeatureCategoryId?: AssistantCategoryId | null;
};

export type SessionSurfaceLayoutMode = {
  personalAssistantDraftHome: boolean;
  expertDraftHome: boolean;
  expertEmptyComposer: boolean;
  homeComposerLayout: boolean;
  composerOuterBorderVisible: boolean;
  draftWorkspaceAccessoryActive: boolean;
  assistantDraftHomeTitle: string;
  assistantDraftHomeSubtitle: string;
};

export function deriveSessionSurfaceLayoutMode(
  input: SessionSurfaceLayoutModeInput,
): SessionSurfaceLayoutMode {
  const personalAssistantDraftHome =
    Boolean(input.personalAssistantHome) &&
    Boolean(input.draftOnly) &&
    input.renderedMessageCount === 0 &&
    !input.hasVisibleTranscriptError &&
    input.activityIdle;

  const expertDraftHome =
    !input.personalAssistantHome &&
    Boolean(input.draftOnly) &&
    input.hasAgentContext &&
    input.renderedMessageCount === 0 &&
    !input.hasVisibleTranscriptError &&
    input.activityIdle;

  /** Empty expert chat (draft or zero-message session) — same compact composer as assistant home. */
  const expertEmptyComposer =
    !input.personalAssistantHome &&
    (input.hasEffectiveAgent || input.hasAgentContext) &&
    input.renderedMessageCount === 0 &&
    !input.hasTranscriptContent &&
    !input.hasVisibleTranscriptError &&
    input.activityIdle;

  const homeComposerLayout =
    personalAssistantDraftHome || expertDraftHome || expertEmptyComposer;

  // Workspace/permission foot row is **assistant draft home only**.
  // Expert always gets assistantFeatureCategoryId ("office") for side panels, but
  // must not show "选择工作空间" — experts isolate runtime dirs automatically.
  // Also require idle so the bar does not stick under a mid-send 准备中 shell.
  const draftWorkspaceAccessoryActive =
    Boolean(input.personalAssistantHome) &&
    Boolean(input.draftOnly) &&
    input.activityIdle;

  const assistantDraftHomeTitle = t("session.assistant_work_title");
  const assistantDraftHomeSubtitle = t("session.assistant_work_subtitle");

  return {
    personalAssistantDraftHome,
    expertDraftHome,
    expertEmptyComposer,
    homeComposerLayout,
    composerOuterBorderVisible: homeComposerLayout,
    draftWorkspaceAccessoryActive,
    assistantDraftHomeTitle,
    assistantDraftHomeSubtitle,
  };
}
