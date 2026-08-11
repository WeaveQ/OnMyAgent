/** @jsxImportSource react */
/**
 * Always-mounted listener for desktop quick-capture submits.
 * SessionRoute may be unmounted (settings / welcome); we enqueue + navigate
 * so the session shell can create a new task when it mounts.
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { QUICK_CAPTURE_SUBMIT_EVENT } from "./keymap-dispatcher";
import { readActiveWorkspaceId } from "./session-memory";
import {
  enqueuePendingQuickCapture,
  isSessionRoutePath,
  resolveQuickCaptureAssistantRoute,
} from "./quick-capture-pending";

export function QuickCaptureSubmitBridge() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onSubmit = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          text?: string;
          mode?: string;
          model?: { providerID?: string; modelID?: string };
        }>
      ).detail;
      const text = String(detail?.text ?? "").trim();
      if (!text) return;

      const providerID = String(detail?.model?.providerID ?? "").trim();
      const modelID = String(detail?.model?.modelID ?? "").trim();
      const model =
        providerID && modelID ? { providerID, modelID } : undefined;

      const enqueued = enqueuePendingQuickCapture({ text, model });
      if (!enqueued) return;

      // Leave settings / welcome / other non-session routes so SessionRoute
      // mounts and can take the pending payload.
      if (!isSessionRoutePath(location.pathname)) {
        const workspaceId = readActiveWorkspaceId();
        const target = resolveQuickCaptureAssistantRoute(workspaceId);
        console.info("[quick-capture] navigate from non-session route", {
          from: location.pathname,
          to: target,
        });
        navigate(target);
      }
    };

    window.addEventListener(QUICK_CAPTURE_SUBMIT_EVENT, onSubmit);
    return () => {
      window.removeEventListener(QUICK_CAPTURE_SUBMIT_EVENT, onSubmit);
    };
  }, [location.pathname, navigate]);

  return null;
}
