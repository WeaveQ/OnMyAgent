/** Model picker open/query/options state + den-session version + toast open events. */
import { useCallback, useMemo, useState } from "react";

import type { ModelOption } from "../../../app/types";
import {
  useDenSessionVersionBump,
  usePendingModelPickerEvents,
} from "./model-picker-events";

export function useSessionRouteModelPickerState() {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [compactModelPickerOpen, setCompactModelPickerOpen] = useState(false);
  const [modelPickerQuery, setModelPickerQuery] = useState("");
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [recentProviderIds, setRecentProviderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [denSessionVersion, setDenSessionVersion] = useState(0);

  const bumpDenSessionVersion = useCallback(() => {
    setDenSessionVersion((version) => version + 1);
  }, []);
  useDenSessionVersionBump(bumpDenSessionVersion);

  const openModelPickerFromPendingProvider = useCallback(() => {
    setModelPickerOpen(true);
  }, []);
  const modelPickerEventHandlers = useMemo(
    () => ({
      openModelPicker: openModelPickerFromPendingProvider,
      setRecentProviderIds,
    }),
    [openModelPickerFromPendingProvider],
  );
  usePendingModelPickerEvents(modelPickerEventHandlers);

  return {
    modelPickerOpen,
    setModelPickerOpen,
    compactModelPickerOpen,
    setCompactModelPickerOpen,
    modelPickerQuery,
    setModelPickerQuery,
    modelOptions,
    setModelOptions,
    recentProviderIds,
    setRecentProviderIds,
    denSessionVersion,
    bumpDenSessionVersion,
  };
}
