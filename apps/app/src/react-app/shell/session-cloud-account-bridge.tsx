/** @jsxImportSource react */
import { useEffect } from "react";

import { usePlatform } from "../kernel/platform";
import { useCloudSession, useDenSession } from "../domains/settings";
import type { SessionSidebarAccount } from "./session-route-model";

export function SessionCloudAccountBridge(props: {
  developerMode: boolean;
  onAccountChange: (account: SessionSidebarAccount | null) => void;
}) {
  const platform = usePlatform();
  const { authToken, user } = useCloudSession();
  const onAccountChange = props.onAccountChange;

  useDenSession({
    developerMode: props.developerMode,
    openLink: platform.openLink,
  });

  useEffect(() => {
    if (!authToken.trim() || !user) {
      onAccountChange(null);
      return;
    }
    onAccountChange({
      name: user.name?.trim() || user.email,
      email: user.email,
    });
  }, [authToken, onAccountChange, user]);

  return null;
}
