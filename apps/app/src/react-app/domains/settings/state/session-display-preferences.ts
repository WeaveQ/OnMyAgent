import { useCallback } from "react";

import {
  DEFAULT_SHOW_FOLLOW_UP_SUGGESTIONS,
  DEFAULT_SHOW_THINKING,
  useLocal,
} from "../../../kernel/local-provider";

type BooleanUpdater = boolean | ((current: boolean) => boolean);

export function useSessionDisplayPreferences() {
  const { prefs, setPrefs } = useLocal();

  const setShowThinking = useCallback(
    (value: BooleanUpdater) => {
      setPrefs((previous) => ({
        ...previous,
        showThinking:
          typeof value === "function" ? value(previous.showThinking) : value,
      }));
    },
    [setPrefs],
  );

  const toggleShowThinking = useCallback(() => {
    setShowThinking((current) => !current);
  }, [setShowThinking]);

  const setShowFollowUpSuggestions = useCallback(
    (value: BooleanUpdater) => {
      setPrefs((previous) => ({
        ...previous,
        showFollowUpSuggestions:
          typeof value === "function"
            ? value(previous.showFollowUpSuggestions !== false)
            : value,
      }));
    },
    [setPrefs],
  );

  const toggleShowFollowUpSuggestions = useCallback(() => {
    setShowFollowUpSuggestions((current) => !current);
  }, [setShowFollowUpSuggestions]);

  const resetSessionDisplayPreferences = useCallback(() => {
    setShowThinking(DEFAULT_SHOW_THINKING);
    setShowFollowUpSuggestions(DEFAULT_SHOW_FOLLOW_UP_SUGGESTIONS);
  }, [setShowFollowUpSuggestions, setShowThinking]);

  return {
    showThinking: prefs.showThinking,
    setShowThinking,
    toggleShowThinking,
    showFollowUpSuggestions: prefs.showFollowUpSuggestions !== false,
    setShowFollowUpSuggestions,
    toggleShowFollowUpSuggestions,
    resetSessionDisplayPreferences,
  };
}
