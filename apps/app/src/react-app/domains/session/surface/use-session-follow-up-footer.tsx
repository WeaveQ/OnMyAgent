/** @jsxImportSource react */
import { useMemo, type ReactNode } from "react";
import type { UIMessage } from "ai";
import { FollowUpSuggestionChips } from "./follow-up-suggestion-chips";
import {
  latestAssistantText,
  latestUserTextBeforeAssistant,
  resolveFollowUpSuggestions,
} from "./follow-up-suggestions";

export function useSessionFollowUpFooter(input: {
  chatStreaming: boolean;
  sending: boolean;
  showInlineActivityIndicator: boolean;
  showNoVisibleAssistantOutput: boolean;
  outputLimitedAssistantMessage: unknown;
  draftOnly?: boolean;
  renderedMessages: UIMessage[];
  agentId?: string;
  quickPrompts?: string[] | null;
  assistantStatusFooter: ReactNode;
  reserveAssistantStatusSpace: boolean;
  typeComposerText: (prompt: string) => void | Promise<void>;
}): ReactNode {
  const followUpSuggestions = useMemo(() => {
    if (
      input.chatStreaming
      || input.sending
      || input.showInlineActivityIndicator
      || input.showNoVisibleAssistantOutput
      || Boolean(input.outputLimitedAssistantMessage)
      || input.draftOnly
      || input.renderedMessages.length === 0
    ) {
      return [];
    }
    return resolveFollowUpSuggestions({
      lastAssistantText: latestAssistantText(input.renderedMessages),
      lastUserText: latestUserTextBeforeAssistant(input.renderedMessages),
      agentId: input.agentId,
      quickPrompts: input.quickPrompts ?? undefined,
    });
  }, [
    input.agentId,
    input.chatStreaming,
    input.draftOnly,
    input.outputLimitedAssistantMessage,
    input.quickPrompts,
    input.renderedMessages,
    input.sending,
    input.showInlineActivityIndicator,
    input.showNoVisibleAssistantOutput,
  ]);

  return useMemo(() => {
    const chips =
      followUpSuggestions.length > 0 ? (
        <FollowUpSuggestionChips
          suggestions={followUpSuggestions}
          onSelect={(prompt) => {
            void input.typeComposerText(prompt);
          }}
        />
      ) : null;
    // Drop spacer when chips fill this slot (avoid blank gap under turn actions).
    const statusNode =
      chips && input.reserveAssistantStatusSpace
        ? null
        : input.assistantStatusFooter;
    if (!statusNode && !chips) return null;
    return (
      <>
        {statusNode}
        {chips}
      </>
    );
  }, [
    followUpSuggestions,
    input.assistantStatusFooter,
    input.reserveAssistantStatusSpace,
    input.typeComposerText,
  ]);
}
