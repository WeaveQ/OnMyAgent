/**
 * Optional controlled chrome for AutomationPage when embedded under the
 * primary-rail left nav (option B).
 */
import { useEffect, useState } from "react";

export type AutomationStatusTab = "tasks" | "runs";

export function useAutomationPageChrome(input: {
  statusTab?: AutomationStatusTab;
  onStatusTabChange?: (tab: AutomationStatusTab) => void;
  templateViewOpen?: boolean;
  onTemplateViewOpenChange?: (open: boolean) => void;
  createRequestId?: number;
  onCreateRequest?: () => void;
}) {
  const [templateViewOpenLocal, setTemplateViewOpenLocal] = useState(false);
  const templateViewOpen =
    input.templateViewOpen !== undefined
      ? input.templateViewOpen
      : templateViewOpenLocal;
  const setTemplateViewOpen = (open: boolean) => {
    input.onTemplateViewOpenChange?.(open);
    if (input.templateViewOpen === undefined) setTemplateViewOpenLocal(open);
  };

  const [activeStatusTabLocal, setActiveStatusTabLocal] =
    useState<AutomationStatusTab>("tasks");
  const activeStatusTab = input.statusTab ?? activeStatusTabLocal;
  const setActiveStatusTab = (tab: AutomationStatusTab) => {
    input.onStatusTabChange?.(tab);
    if (input.statusTab === undefined) setActiveStatusTabLocal(tab);
  };

  useEffect(() => {
    if (!input.createRequestId) return;
    input.onCreateRequest?.();
    // Only the bump should fire create — ignore unstable callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.createRequestId]);

  return {
    templateViewOpen,
    setTemplateViewOpen,
    activeStatusTab,
    setActiveStatusTab,
  };
}
