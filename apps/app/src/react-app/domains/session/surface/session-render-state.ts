import type { UIMessage } from "ai";

import type { OnMyAgentSessionSnapshot } from "../../../../app/lib/onmyagent-server";
import { mergeSnapshotAndLiveMessages } from "../sync/message-merge";
import { applyRevertCursor } from "../sync/transcript-reconcile";
import { snapshotToUIMessages } from "../sync/usechat-adapter";

export const INTERNAL_SESSION_MESSAGE_ID_PREFIX = "msg_onmyagent-internal-";

function isInternalSessionControlMessage(message: UIMessage) {
  return message.id.startsWith(INTERNAL_SESSION_MESSAGE_ID_PREFIX);
}

function readRevertMessageId(session: OnMyAgentSessionSnapshot["session"] | null | undefined) {
  if (!session || !("revert" in session)) return null;
  const revert = session.revert;
  if (!revert || typeof revert !== "object" || Array.isArray(revert)) return null;
  const messageId = (revert as Record<string, unknown>).messageID;
  return typeof messageId === "string" && messageId.trim() ? messageId : null;
}

export function resolveRenderedSessionSnapshot(input: {
  sessionId: string;
  currentSnapshot: OnMyAgentSessionSnapshot | null | undefined;
  cachedRendered: { sessionId: string; snapshot: OnMyAgentSessionSnapshot } | null | undefined;
}) {
  if (input.currentSnapshot?.session.id === input.sessionId) {
    return input.currentSnapshot;
  }
  if (
    input.cachedRendered?.sessionId === input.sessionId &&
    input.cachedRendered.snapshot.session.id === input.sessionId
  ) {
    return input.cachedRendered.snapshot;
  }
  return null;
}

export function deriveRenderedSessionMessages(input: {
  transcriptState: UIMessage[] | null | undefined;
  snapshot: OnMyAgentSessionSnapshot | null | undefined;
}) {
  const revertMessageId = readRevertMessageId(input.snapshot?.session);
  const liveMessages = input.transcriptState ?? [];

  const snapshotMessages = input.snapshot && input.snapshot.messages.length > 0
    ? snapshotToUIMessages(input.snapshot)
    : [];

  // Render the server snapshot as the history floor and layer live stream
  // updates on top. During prompt submission the live cache can briefly contain
  // only the new turn; it must not replace the older persisted transcript.
  const messages = snapshotMessages.length > 0
    ? mergeSnapshotAndLiveMessages(snapshotMessages, liveMessages, { appendLiveOnlyMessages: true })
    : liveMessages;

  return applyRevertCursor(messages, revertMessageId).filter(
    (message) => !isInternalSessionControlMessage(message),
  );
}
