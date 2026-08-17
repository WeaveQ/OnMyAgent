import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";

import type { ExpertDirectoryRecord } from "@onmyagent/types/server";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import { t } from "../../../../i18n";
import { expertDirectoryQueryKey } from "../../../capabilities/session-identity/expert-directory-query";
import { useStatusToasts } from "../../shell-feedback/status-toasts";
import {
  dismissExpertMissingSkillsNotice,
  isExpertMissingSkillsNoticeDismissed,
  repairExpertMissingSkills,
} from "./expert-missing-skills-repair";

export function useExpertMissingSkillsNotice(input: {
  enabled: boolean;
  workspaceId: string;
  agentId: string | null;
  missingSkills: readonly string[];
  record?: Pick<
    ExpertDirectoryRecord,
    "sessions" | "runtimeDirectories" | "packageName" | "declaredSkills" | "missingSkills"
  > | null;
  client: OnMyAgentServerClient | null;
}): void {
  const queryClient = useQueryClient();
  const { showToast, dismissToast } = useStatusToasts();
  const toastIdRef = useRef<string | null>(null);
  const persistDismissRef = useRef(true);
  const repairRef = useRef<() => Promise<void>>(async () => undefined);
  const skillsKey = input.missingSkills.join("\0");

  repairRef.current = async () => {
    const workspaceId = input.workspaceId.trim();
    const agentId = input.agentId?.trim() ?? "";
    const skills = input.missingSkills;
    if (!workspaceId || !agentId || !input.client) return;
    persistDismissRef.current = false;
    if (toastIdRef.current) {
      dismissToast(toastIdRef.current);
      toastIdRef.current = null;
    }
    const tag = `expert-missing-skills:${workspaceId}:${agentId}`;
    showToast({
      tag,
      tone: "info",
      title: t("session.expert_missing_skills_repairing"),
      durationMs: 0,
      icon: LoaderCircle,
      spinIcon: true,
    });
    try {
      const result = await repairExpertMissingSkills({
        client: input.client,
        workspaceId,
        agentId,
        record: input.record,
        ...(input.record?.declaredSkills?.length
          ? { skillNames: input.record.declaredSkills }
          : {}),
      });
      await queryClient.invalidateQueries({
        queryKey: expertDirectoryQueryKey(workspaceId),
      });
      if (result.remaining.length === 0) {
        dismissExpertMissingSkillsNotice({ workspaceId, agentId, skills });
        // Drop ownership so a later hide (empty remaining) does not
        // immediately dismiss the success toast.
        toastIdRef.current = null;
        showToast({
          tag,
          tone: "success",
          title: t("session.expert_missing_skills_repaired"),
          durationMs: 4_000,
        });
        return;
      }
      persistDismissRef.current = true;
      toastIdRef.current = showToast({
        tag,
        tone: "warning",
        title: t("session.expert_missing_skills_title"),
        description: t("session.expert_missing_skills_body", {
          skills: result.remaining.join(", "),
        }),
        actionLabel: t("session.expert_missing_skills_repair"),
        dismissLabel: t("session.expert_missing_skills_dismiss"),
        durationMs: 0,
        onAction: () => {
          void repairRef.current();
        },
        onDismiss: () => {
          if (persistDismissRef.current) {
            dismissExpertMissingSkillsNotice({
              workspaceId,
              agentId,
              skills: result.remaining,
            });
          }
        },
      });
    } catch {
      persistDismissRef.current = true;
      toastIdRef.current = showToast({
        tag,
        tone: "error",
        title: t("session.expert_missing_skills_repair_failed"),
        actionLabel: t("session.expert_missing_skills_repair"),
        dismissLabel: t("session.expert_missing_skills_dismiss"),
        durationMs: 0,
        onAction: () => {
          void repairRef.current();
        },
        onDismiss: () => {
          if (persistDismissRef.current) {
            dismissExpertMissingSkillsNotice({ workspaceId, agentId, skills });
          }
        },
      });
    }
  };

  useEffect(() => {
    const workspaceId = input.workspaceId.trim();
    const agentId = input.agentId?.trim() ?? "";
    const skills = input.missingSkills
      .map((skill) => skill.trim())
      .filter(Boolean);
    const tag = `expert-missing-skills:${workspaceId}:${agentId}`;
    const hide =
      !input.enabled ||
      !workspaceId ||
      !agentId ||
      skills.length === 0 ||
      isExpertMissingSkillsNoticeDismissed({ workspaceId, agentId, skills });
    if (hide) {
      persistDismissRef.current = false;
      if (toastIdRef.current) {
        dismissToast(toastIdRef.current);
        toastIdRef.current = null;
      }
      return;
    }
    persistDismissRef.current = true;
    toastIdRef.current = showToast({
      tag,
      tone: "warning",
      title: t("session.expert_missing_skills_title"),
      description: t("session.expert_missing_skills_body", { skills: skills.join(", ") }),
      actionLabel: t("session.expert_missing_skills_repair"),
      dismissLabel: t("session.expert_missing_skills_dismiss"),
      durationMs: 0,
      onAction: () => {
        void repairRef.current();
      },
      onDismiss: () => {
        if (persistDismissRef.current) {
          dismissExpertMissingSkillsNotice({ workspaceId, agentId, skills });
        }
      },
    });
  }, [
    dismissToast,
    input.enabled,
    input.workspaceId,
    input.agentId,
    showToast,
    skillsKey,
  ]);
}
