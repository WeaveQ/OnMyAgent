import type { ReactNode } from "react";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import type { ModelRef } from "../../../app/types";
import type {
  AgentRecord,
  AgentRegistry,
  AgentSkillItem,
  AgentWizardDraft,
} from "./agent-registry";
import type {
  ExpertCreationComposerProps,
  ExpertCreationSuggestionApplyOptions,
} from "./expert-creation-conversation";
import type { ExpertDraftSuggestion } from "./expert-creation-suggestions";

export type ExpertCreationTab = "basic" | "memory" | "skills" | "knowledge";

export type ExpertKnowledgeEntry = {
  kind: "file" | "directory";
  relativePath: string;
  file?: File;
  stagedPath?: string;
};

export type ExpertKnowledgeNode = ExpertKnowledgeEntry & { name: string };

export type ExpertCreationPageProps = {
  showToast?: (input: {
    title: string;
    description: string;
    tone: "success";
    durationMs: number;
  }) => void;
  workspaceId: string;
  workspaceRoot: string;
  opencodeBaseUrl: string | null;
  onmyagentServerToken: string | null;
  client: OnMyAgentServerClient | null;
  registry: AgentRegistry | null;
  skills: AgentSkillItem[];
  selectedModel: ModelRef | null;
  editingAgent?: AgentRecord | null;
  renderCoachPanel?: (input: {
    draft: AgentWizardDraft;
    registry: AgentRegistry;
    showModelPicker: boolean;
    initialSessionId: string | null;
    onSessionIdChange: (sessionId: string) => void;
    onApplyDraftSuggestion: (
      suggestion: ExpertDraftSuggestion,
      options: ExpertCreationSuggestionApplyOptions,
    ) => void;
  }) => ReactNode;
  renderPreviewPanel?: (input: {
    draft: AgentWizardDraft;
    registry: AgentRegistry;
    showModelPicker: boolean;
    knowledgePaths: readonly string[];
    sessionKey: string;
    emptyContent: ReactNode;
  }) => ReactNode;
  renderComposer: (props: ExpertCreationComposerProps) => ReactNode;
  onClose: () => void;
  onDone: (
    draft: AgentWizardDraft,
    knowledge: ExpertKnowledgeEntry[],
    availableSkills: AgentSkillItem[],
    draftId: string,
    coachSessionId: string | null,
  ) => Promise<void>;
};
