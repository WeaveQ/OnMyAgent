/** Props contract for SessionSurface (domain bags reduce top-level surface). */
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

export type SessionSurfaceModelBag = {
  modelLabel: string;
  onModelClick: () => void;
  modelPickerOpen: boolean;
  modelUnavailable?: boolean;
  selectedModel: ModelRef;
  onModelPickerOpenChange: (open: boolean) => void;
  onModelChange: (model: ModelRef) => void;
  modelVariantLabel: string;
  modelVariant: string | null;
  modelBehaviorOptions?: { value: string | null; label: string }[];
  onModelVariantChange: (value: string | null) => void;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
};

export type SessionSurfaceCollaborationBag = {
  sessionAccessMode?: ComposerAccessMode;
  onSessionAccessModeChange?: (mode: ComposerAccessMode) => void;
  sessionCollaborationMode?: ComposerCollaborationMode;
  onSessionCollaborationModeChange?: (mode: ComposerCollaborationMode) => void;
  planRuntime?: CollaborationPlanRuntime | null;
  onPlanRuntimeChange?: (runtime: CollaborationPlanRuntime | null) => void;
  goalRuntime?: CollaborationGoalRuntime | null;
  onGoalRuntimeChange?: (runtime: CollaborationGoalRuntime | null) => void;
  onClearSessionProgress?: () => void;
};

export type SessionSurfacePermissionBag = {
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
};

export type SessionSurfaceMarketplaceBag = {
  onOpenSettingsSection?:
    | ((section: "commands" | "skills" | "mcps" | "plugins") => void)
    | undefined;
  onOpenSkillsMarketplace?: (() => void) | undefined;
  onOpenConnectorsMarketplace?: (() => void) | undefined;
  onOpenCustomConnector?: (() => void) | undefined;
};

export type SessionSurfaceDraftWorkspaceBag = {
  draftWorkspaceDirectory?: string | null;
  draftWorkspaceOwnerId?: string | null;
  onSelectDraftWorkspace?: (path: string) => void;
  onCreateDraftWorkspace?: (name: string) => Promise<string>;
  onPickDraftWorkspace?: () => void;
  onClearDraftWorkspace?: () => void;
};

/** Public SessionSurface props — domain bags keep top-level count low. */
export type SessionSurfaceProps = {
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
  draftOnly?: boolean;
  /**
   * False while the host keep-alive pane is hidden (other rail pages).
   * Used to persist / restore transcript scroll height across page leaves.
   */
  surfaceVisible?: boolean;
  opencodeBaseUrl: string;
  onmyagentToken: string;
  developerMode: boolean;
  model: SessionSurfaceModelBag;
  collaboration: SessionSurfaceCollaborationBag;
  permission: SessionSurfacePermissionBag;
  marketplace: SessionSurfaceMarketplaceBag;
  draftWorkspace: SessionSurfaceDraftWorkspaceBag;
  onSendDraft: (draft: ComposerDraft) => void;
  onDraftChange: (draft: ComposerDraft) => void;
  attachmentsEnabled: boolean;
  attachmentsDisabledReason: string | null;
  agentLabel: string;
  userIdentity?: { name: string };
  onOpenAgentSettings?: () => void;
  headerActions?: ReactNode;
  conversationTabs?: ReactNode;
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
  extraComposerAccessory?: import("react").ReactNode;
  safeStringify?: (value: unknown) => string;
  onUploadInboxFiles?:
    | ((
        files: File[],
        options?: { notify?: boolean },
      ) => void | Promise<unknown>)
    | null;
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
};

/** Flat view used inside SessionSurface body (behavior-preserving). */
export type SessionSurfaceFlatProps = Omit<
  SessionSurfaceProps,
  "model" | "collaboration" | "permission" | "marketplace" | "draftWorkspace"
> &
  SessionSurfaceModelBag &
  SessionSurfaceCollaborationBag &
  SessionSurfacePermissionBag &
  SessionSurfaceMarketplaceBag &
  SessionSurfaceDraftWorkspaceBag;

export function flattenSessionSurfaceProps(
  props: SessionSurfaceProps,
): SessionSurfaceFlatProps {
  const {
    model,
    collaboration,
    permission,
    marketplace,
    draftWorkspace,
    ...rest
  } = props;
  return {
    ...rest,
    ...model,
    ...collaboration,
    ...permission,
    ...marketplace,
    ...draftWorkspace,
  };
}

/** Group a flat surface props object (legacy assembly) into domain bags. */
export function bagSessionSurfaceProps(
  flat: SessionSurfaceFlatProps,
): SessionSurfaceProps {
  const {
    modelLabel,
    onModelClick,
    modelPickerOpen,
    modelUnavailable,
    selectedModel,
    onModelPickerOpenChange,
    onModelChange,
    modelVariantLabel,
    modelVariant,
    modelBehaviorOptions,
    onModelVariantChange,
    onChangeModel,
    sessionAccessMode,
    onSessionAccessModeChange,
    sessionCollaborationMode,
    onSessionCollaborationModeChange,
    planRuntime,
    onPlanRuntimeChange,
    goalRuntime,
    onGoalRuntimeChange,
    onClearSessionProgress,
    activePermission,
    permissionReplyBusy,
    respondPermission,
    autoApprovedPermissionNoticeId,
    activeQuestion,
    questionReplyBusy,
    respondQuestion,
    onOpenSettingsSection,
    onOpenSkillsMarketplace,
    onOpenConnectorsMarketplace,
    onOpenCustomConnector,
    draftWorkspaceDirectory,
    draftWorkspaceOwnerId,
    onSelectDraftWorkspace,
    onCreateDraftWorkspace,
    onPickDraftWorkspace,
    onClearDraftWorkspace,
    ...rest
  } = flat;
  return {
    ...rest,
    model: {
      modelLabel,
      onModelClick,
      modelPickerOpen,
      modelUnavailable,
      selectedModel,
      onModelPickerOpenChange,
      onModelChange,
      modelVariantLabel,
      modelVariant,
      modelBehaviorOptions,
      onModelVariantChange,
      onChangeModel,
    },
    collaboration: {
      sessionAccessMode,
      onSessionAccessModeChange,
      sessionCollaborationMode,
      onSessionCollaborationModeChange,
      planRuntime,
      onPlanRuntimeChange,
      goalRuntime,
      onGoalRuntimeChange,
      onClearSessionProgress,
    },
    permission: {
      activePermission,
      permissionReplyBusy,
      respondPermission,
      autoApprovedPermissionNoticeId,
      activeQuestion,
      questionReplyBusy,
      respondQuestion,
    },
    marketplace: {
      onOpenSettingsSection,
      onOpenSkillsMarketplace,
      onOpenConnectorsMarketplace,
      onOpenCustomConnector,
    },
    draftWorkspace: {
      draftWorkspaceDirectory,
      draftWorkspaceOwnerId,
      onSelectDraftWorkspace,
      onCreateDraftWorkspace,
      onPickDraftWorkspace,
      onClearDraftWorkspace,
    },
  };
}
