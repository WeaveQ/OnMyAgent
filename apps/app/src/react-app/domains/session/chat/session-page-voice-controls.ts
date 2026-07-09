import { useMemo } from "react";

import { t } from "../../../../i18n";
import { type OpenworkControlAction, useControlAction } from "../../../shell";
import type { SidePanelItem } from "../../../shell";

type UseSessionPageVoiceControlsInput = {
  activeSidePanel: SidePanelItem | null;
  voiceExtensionEnabled: boolean;
  setCurrentSidePanel: (panel: SidePanelItem | null) => void;
};

export function useSessionPageVoiceControls(
  input: UseSessionPageVoiceControlsInput,
) {
  const { activeSidePanel, setCurrentSidePanel, voiceExtensionEnabled } = input;
  const openVoicePanelControlAction = useMemo<OpenworkControlAction | null>(
    () =>
      voiceExtensionEnabled
        ? {
            id: "voice.panel.open",
            label: t("session.open_voice_mode"),
            description: t("session.open_voice_mode_desc"),
            sideEffect: "none",
            execute: () => {
              setCurrentSidePanel("voice");
              return { open: true };
            },
          }
        : null,
    [setCurrentSidePanel, voiceExtensionEnabled],
  );
  useControlAction(openVoicePanelControlAction);

  const closeVoicePanelControlAction = useMemo<OpenworkControlAction | null>(
    () =>
      voiceExtensionEnabled && activeSidePanel === "voice"
        ? {
            id: "voice.panel.close",
            label: t("session.close_voice_mode"),
            description: t("session.close_voice_mode_desc"),
            sideEffect: "none",
            execute: () => {
              setCurrentSidePanel(null);
              return { open: false };
            },
          }
        : null,
    [activeSidePanel, setCurrentSidePanel, voiceExtensionEnabled],
  );
  useControlAction(closeVoicePanelControlAction);
}
