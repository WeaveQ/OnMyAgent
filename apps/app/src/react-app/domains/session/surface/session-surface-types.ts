/** Props contract for SessionSurface (extracted for maintainability). */
import type { ReactNode } from "react";

import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import type {
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerAccessMode,
  ComposerCollaborationMode,
  ComposerDraft,
  ModelRef,
  PendingPermission,
  PendingQuestion,
  TodoItem,
} from "../../../../app/types";
import type { PendingAgentContext } from "../../agents";
import type { OpenTarget } from "../../../capabilities/artifacts/open-target";
import type { AssistantCategoryId } from "./personal-assistant-config";

export type SessionSurfaceProps = {
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
  draftOnly?: boolean;
  opencodeBaseUrl: string;
  onmyagentToken: string;
  developerMode: boolean;
  modelLabel: string;
  onModelClick: () => void;
  modelPickerOpen: boolean;
  modelUnavailable?: boolean;
  selectedModel: ModelRef;
  onModelPickerOpenChange: (open: boolean) => void;
  onModelChange: (model: ModelRef) => void;
  onSendDraft: (draft: ComposerDraft) => void;
  onDraftChange: (draft: ComposerDraft) => void;
  sessionAccessMode?: ComposerAccessMode;
  onSessionAccessModeChange?: (mode: ComposerAccessMode) => void;
  sessionCollaborationMode?: ComposerCollaborationMode;
  onSessionCollaborationModeChange?: (mode: ComposerCollaborationMode) => void;
  planRuntime?: CollaborationPlanRuntime | null;
  onPlanRuntimeChange?: (runtime: CollaborationPlanRuntime | null) => void;
  goalRuntime?: CollaborationGoalRuntime | null;
  onGoalRuntimeChange?: (runtime: CollaborationGoalRuntime | null) => void;
  onClearSessionProgress?: () => void;
  attachmentsEnabled: boolean;
  attachmentsDisabledReason: string | null;
  modelVariantLabel: string;
  modelVariant: string | null;
  modelBehaviorOptions?: { value: string | null; label: string }[];
  onModelVariantChange: (value: string | null) => void;
  agentLabel: string;
  userIdentity?: { name: string };
  onOpenAgentSettings?: () => void;
  headerActions?: ReactNode;
  conversationTabs?: ReactNode;
  /** In-conversation find: highlight + navigate matches in the transcript. */
  searchQuery?: string;
  searchActiveMatchIndex?: number;
  onSearchMatchCountChange?: (count: number) => void;
  selectedAgent: string | null;
  listAgents: () => Promise<import("@opencode-ai/sdk/v2/client").Agent[]>;
  onSelectAgent: (agent: string | null) => void;
  listCommands: () => Promise<
    import("../../../../app/types").SlashCommandOption[]
  >;
  recentFiles: string[];
  searchFiles: (query: string) => Promise<string[]>;
  isRemoteWorkspace: boolean;
  isSandboxWorkspace: boolean;
  todos?: TodoItem[];
  activePermission?: PendingPermission | null;
  permissionReplyBusy?: boolean;
  respondPermission?: (
    requestID: string,
    reply: "once" | "always" | "reject",
  ) => void;
  autoApprovedPermissionNoticeId?: string | null;
  activeQuestion?: PendingQuestion | null;
  questionReplyBusy?: boolean;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
  safeStringify?: (value: unknown) => string;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onUploadInboxFiles?:
    | ((
        files: File[],
        options?: { notify?: boolean },
      ) => void | Promise<unknown>)
    | null;
  onOpenSettingsSection?:
    | ((section: "commands" | "skills" | "mcps" | "plugins") => void)
    | undefined;
  onOpenSkillsMarketplace?: (() => void) | undefined;
  onRevertToMessage?: (messageId: string) => void;
  onForkAtMessage?: (messageId: string) => void;
  onOpenTarget?: (target: OpenTarget, options?: { auto?: boolean }) => void;
  onOpenTargetsChange?: (targets: OpenTarget[]) => void;
  personalAssistantHome?: boolean;
  personalAssistantCategoryId?: AssistantCategoryId;
  assistantFeatureCategoryId?: AssistantCategoryId;
  agentContext?: PendingAgentContext | null;
  onPersonalAssistantCategoryChange?: (id: AssistantCategoryId) => void;
  onPersonalAssistantCategoryActive?: (id: AssistantCategoryId) => void;
  draftWorkspaceDirectory?: string | null;
  /** Active app workspace id — draft picker loads Spaces dirs for this owner. */
  draftWorkspaceOwnerId?: string | null;
  /** Select / create / open a draft workspace path (list or folder picker). */
  onSelectDraftWorkspace?: (path: string) => void;
  /** Create named subfolder under the active app workspace; returns absolute path. */
  onCreateDraftWorkspace?: (name: string) => Promise<string>;
  onPickDraftWorkspace?: () => void;
  onClearDraftWorkspace?: () => void;
};
