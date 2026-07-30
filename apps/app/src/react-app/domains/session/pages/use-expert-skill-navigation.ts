/** @jsxImportSource react */
/**
 * Expert-page skill/create navigation: always open a new assistant office task
 * (never restore the last assistant conversation).
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { installBuiltinSkillPackage } from "../../../../app/lib/desktop";
import { isElectronRuntime } from "../../../../app/utils";
import { t } from "../../../../i18n";
import { usePendingAgentStore } from "../../agents";
import { workspaceAssistantRoute } from "../../../shell";
import { writeAssistantSelectionMemory } from "../sidebar/assistant-selection-memory";
import { writeAssistantCategoryMemory } from "../sidebar/rail-navigation-memory";
import { setComposerDraftAfterNewTask } from "./shared-page-utils";
import { resetRailBookmarkToPrimary } from "./use-rail-location";

const CREATE_EXPERT_SKILL_NAME = "expert-manager";
const CREATE_SKILL_PACKAGE_NAME = "skill-creator";

export function useExpertSkillNavigation(input: {
  workspaceId: string;
  onNavigateToMode: (mode: "assistant" | "expert") => void;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
}) {
  const navigate = useNavigate();
  const workspaceId = input.workspaceId;

  const goAssistantOfficeNewTaskWithDraft = useCallback(
    (draft: string) => {
      const id = workspaceId.trim();
      if (!id) return;
      writeAssistantSelectionMemory(id, "office", { kind: "newTask" });
      writeAssistantCategoryMemory(id, "office");
      resetRailBookmarkToPrimary("assistant", id);
      usePendingAgentStore.getState().setAgent(null);
      setComposerDraftAfterNewTask(id, draft);
      navigate(workspaceAssistantRoute(id));
    },
    [navigate, workspaceId],
  );

  const handleCreateExpert = useCallback(async () => {
    if (isElectronRuntime()) {
      try {
        await installBuiltinSkillPackage({
          source: "builtin",
          packageName: CREATE_EXPERT_SKILL_NAME,
          skillName: CREATE_EXPERT_SKILL_NAME,
        });
      } catch (error) {
        console.warn("[expert-marketplace] failed to install expert-manager", error);
      }
    }
    writeAssistantSelectionMemory(workspaceId, "office", { kind: "newTask" });
    input.onCreateTaskInWorkspace(workspaceId);
    setComposerDraftAfterNewTask(workspaceId, t("session.create_expert_prompt"));
    input.onNavigateToMode("assistant");
  }, [input, workspaceId]);

  const handleCreateSkill = useCallback(() => {
    goAssistantOfficeNewTaskWithDraft(t("session.create_skill_prompt"));
    if (isElectronRuntime()) {
      void installBuiltinSkillPackage({
        source: "builtin",
        packageName: CREATE_SKILL_PACKAGE_NAME,
        skillName: CREATE_SKILL_PACKAGE_NAME,
      }).catch((error) => {
        console.warn(
          `[skills-marketplace] failed to install ${CREATE_SKILL_PACKAGE_NAME}`,
          error,
        );
      });
    }
  }, [goAssistantOfficeNewTaskWithDraft]);

  const handleChatWithSkill = useCallback(
    (skill: { name: string }) => {
      const name = skill.name.trim();
      if (!name) return;
      goAssistantOfficeNewTaskWithDraft(
        t("session.chat_with_skill_prompt", { name }),
      );
    },
    [goAssistantOfficeNewTaskWithDraft],
  );

  const handleEditSkill = useCallback(
    (skill: { name: string }) => {
      const name = skill.name.trim();
      if (!name) return;
      goAssistantOfficeNewTaskWithDraft(t("session.edit_skill_prompt", { name }));
      if (isElectronRuntime()) {
        void installBuiltinSkillPackage({
          source: "builtin",
          packageName: CREATE_SKILL_PACKAGE_NAME,
          skillName: CREATE_SKILL_PACKAGE_NAME,
        }).catch((error) => {
          console.warn(
            "[skills-marketplace] failed to install skill-creator",
            error,
          );
        });
      }
    },
    [goAssistantOfficeNewTaskWithDraft],
  );

  return {
    handleCreateExpert,
    handleCreateSkill,
    handleChatWithSkill,
    handleEditSkill,
  };
}
