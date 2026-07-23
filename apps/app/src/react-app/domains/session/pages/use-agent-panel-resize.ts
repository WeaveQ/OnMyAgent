/**
 * Agent conversation panel width + pointer-resize handler.
 * Shared by ExpertPage and AssistantPage.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useState } from "react";

import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
} from "../sidebar/session-chrome";

export function useAgentPanelResize(initialWidth = AGENT_PANEL_DEFAULT_WIDTH) {
  const [agentPanelWidth, setAgentPanelWidth] = useState(initialWidth);

  const startAgentPanelResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = agentPanelWidth;
      const controller = new AbortController();

      const resize = (moveEvent: PointerEvent) => {
        const nextWidth = Math.min(
          AGENT_PANEL_MAX_WIDTH,
          Math.max(
            AGENT_PANEL_MIN_WIDTH,
            startWidth + moveEvent.clientX - startX,
          ),
        );
        setAgentPanelWidth(nextWidth);
      };
      const stop = () => controller.abort();

      window.addEventListener("pointermove", resize, {
        signal: controller.signal,
      });
      window.addEventListener("pointerup", stop, {
        once: true,
        signal: controller.signal,
      });
      window.addEventListener("pointercancel", stop, {
        once: true,
        signal: controller.signal,
      });
    },
    [agentPanelWidth],
  );

  return {
    agentPanelWidth,
    setAgentPanelWidth,
    startAgentPanelResize,
  };
}
