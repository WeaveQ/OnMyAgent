import { useCallback, useState } from "react";

export type CustomConnectorDialogView = "list" | "config";

/**
 * Shared open/initialView state for CustomConnectorDialog on Expert + Assistant pages.
 */
export function useCustomConnectorDialog() {
  const [customConnectorOpen, setCustomConnectorOpen] = useState(false);
  const [customConnectorInitialView, setCustomConnectorInitialView] =
    useState<CustomConnectorDialogView>("list");

  const openCustomConnector = useCallback(
    (view: CustomConnectorDialogView = "list") => {
      setCustomConnectorInitialView(view);
      setCustomConnectorOpen(true);
    },
    [],
  );

  return {
    customConnectorOpen,
    setCustomConnectorOpen,
    customConnectorInitialView,
    openCustomConnector,
  };
}
