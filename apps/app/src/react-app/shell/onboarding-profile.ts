import type {
  ConversationMemoryState,
  OnboardingProfile,
} from "../kernel/local-provider";
import { buildWorkMemoryContext } from "../domains/shared";

/**
 * Build system prompt for personal profile + confirmed work memory (B' split).
 * Pending is never injected. Expert slot isolation via expertId when provided.
 */
export function buildOnboardingProfileSystemPrompt(
  profile: OnboardingProfile | null,
  conversationMemory?: ConversationMemoryState | null,
  options?: {
    expertId?: string | null;
    handbookText?: string | null;
  },
) {
  return buildWorkMemoryContext({
    profile,
    conversationMemory,
    expertId: options?.expertId,
    handbookText: options?.handbookText,
  }).systemText;
}
