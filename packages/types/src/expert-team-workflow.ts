export type ExpertTeamWorkflowStageKind =
  | "frame"
  | "investigate"
  | "produce"
  | "verify"
  | "deliver";

export type ExpertTeamWorkflowStage = {
  id: string;
  kind: ExpertTeamWorkflowStageKind;
  title: string;
  description: string;
  members: string[];
  deliverables: string[];
  checks: string[];
};

export type ExpertTeamWorkflow = {
  mode: "lead-workflow";
  version: number;
  leadAgentName: string;
  memberCount: number;
  stages: ExpertTeamWorkflowStage[];
};
