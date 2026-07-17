import { useEffect } from "react";

import { denSessionUpdatedEvent } from "../../../app/lib/den-session-events";
import {
  openModelPickerEvent,
  pendingModelPickerProviderIdsKey,
} from "../new-providers-toast";

type ModelPickerEventDetail = {
  newProviderIds?: string[];
  initialTab?: "default" | "available";
};

export function useDenSessionVersionBump(onBump: () => void) {
  useEffect(() => {
    window.addEventListener(denSessionUpdatedEvent, onBump);
    return () => window.removeEventListener(denSessionUpdatedEvent, onBump);
  }, [onBump]);
}

export function usePendingModelPickerEvents(input: {
  openModelPicker: () => void;
  setRecentProviderIds: (ids: Set<string>) => void;
}) {
  useEffect(() => {
    const handler = (event: Event) => {
      try {
        window.localStorage.removeItem(pendingModelPickerProviderIdsKey);
      } catch {}
      const detail = (event as CustomEvent<ModelPickerEventDetail>).detail;
      const ids = detail?.newProviderIds;
      if (ids && ids.length > 0) input.setRecentProviderIds(new Set(ids));
      input.openModelPicker();
    };
    window.addEventListener(openModelPickerEvent, handler);
    return () => window.removeEventListener(openModelPickerEvent, handler);
  }, [input]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(pendingModelPickerProviderIdsKey);
      if (!raw) return;
      window.localStorage.removeItem(pendingModelPickerProviderIdsKey);
      const parsed = JSON.parse(raw);
      const ids = Array.isArray(parsed) ? parsed : parsed?.newProviderIds;
      if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) {
        input.setRecentProviderIds(new Set(ids));
      }
      input.openModelPicker();
    } catch {
      window.localStorage.removeItem(pendingModelPickerProviderIdsKey);
    }
  }, [input]);
}
