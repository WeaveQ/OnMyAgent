/** Conversation runtime adapters (personal ACP + OpenCode UIMessage-like). */

export {
  filterPersonalTimelineMessages,
  groupPersonalTimelineMessages,
  mapPersonalEventToMessages,
  mapPersonalRunToMessages,
  personalMessagesToConversationItems,
  shouldJoinAssistantChunkTightly,
  toConversationItems as toPersonalConversationItems,
  type PersonalAdapterMessage,
  type PersonalAdapterRun,
  type PersonalAdapterRunEvent,
} from "./personal";

export {
  mapOpenCodeMessageToItems,
  mapOpenCodeReasoningPartToItem,
  mapOpenCodeToolPartToItem,
  toConversationItems as toOpenCodeConversationItems,
  type OpenCodeMessageLike,
  type OpenCodeMessagePartLike,
} from "./opencode";
