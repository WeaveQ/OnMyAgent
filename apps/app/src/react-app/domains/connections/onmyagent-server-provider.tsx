/** @jsxImportSource react */
import {
  createContext,
  use,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { APP_NAME, APP_NAME_LOWER } from "../../../i18n/locales/brand";

import type { OnMyAgentServerStore } from "../shared/onmyagent-server-store";

const OnMyAgentServerContext = createContext<OnMyAgentServerStore | null>(null);

export function OnMyAgentServerProvider(props: {
  store: OnMyAgentServerStore;
  children: ReactNode;
}) {
  return (
    <OnMyAgentServerContext.Provider value={props.store}>
      {props.children}
    </OnMyAgentServerContext.Provider>
  );
}

export function useOnMyAgentServer() {
  const store = use(OnMyAgentServerContext);
  if (!store) {
    throw new Error(
      `use${APP_NAME}Server must be used within an ${APP_NAME}ServerProvider`,
    );
  }

  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return store;
}
