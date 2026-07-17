/** Shared session-surface constants (extracted for focused modules). */
import type { UIMessage } from "ai";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";

export const EMPTY_TRANSCRIPT: UIMessage[] = [];
export const IDLE_STATUS: SessionStatus = { type: "idle" };

export const ASSISTANT_STALL_NOTICE_MS = 15_000;
export const ASSISTANT_RECOVERY_HINT_MS = 120_000;
export const MAX_TRANSCRIPT_NOTICES_PER_SESSION = 16;
