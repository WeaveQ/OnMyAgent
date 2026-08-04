/** @jsxImportSource react */
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type {
  ExpertCreationSuggestionApplyOptions,
  ExpertDraftSuggestion,
} from "../../agents";

export type ExpertCreationSuggestionAccessoryProps = {
  title: ReactNode;
  detail: ReactNode;
  dismissLabel: ReactNode;
  confirmLabel: ReactNode;
  onDismiss: () => void;
  onConfirm: () => void;
};

export function ExpertCreationSuggestionAccessory(
  props: ExpertCreationSuggestionAccessoryProps,
) {
  return (
    <div
      data-slot="expert-creation-suggestion-accessory"
      className="rounded-xl border border-dls-border bg-dls-surface-muted px-3 py-3"
    >
      <p className="text-sm font-medium text-dls-text">{props.title}</p>
      <p className="mt-1 text-xs leading-5 text-dls-secondary">
        {props.detail}
      </p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={props.onDismiss}>
          {props.dismissLabel}
        </Button>
        <Button type="button" variant="default" size="sm" onClick={props.onConfirm}>
          {props.confirmLabel}
        </Button>
      </div>
    </div>
  );
}

export function confirmExpertCreationSuggestion(input: {
  pendingSuggestion: ExpertDraftSuggestion | null;
  onApplyDraftSuggestion: (
    suggestion: ExpertDraftSuggestion,
    options: ExpertCreationSuggestionApplyOptions,
  ) => void;
  onConfirmed: () => void;
}): boolean {
  if (!input.pendingSuggestion) return false;
  input.onApplyDraftSuggestion(input.pendingSuggestion, { mode: "force" });
  input.onConfirmed();
  return true;
}
