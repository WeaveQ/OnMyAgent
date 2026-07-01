/** @jsxImportSource react */
import {
  createContext,
  use,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { APP_NAME, APP_NAME_LOWER } from "../../../i18n/locales/brand";

import type { OpenworkServerStore } from "../shared/onmyagent-server-store";

const OpenworkServerContext = createContext<OpenworkServerStore | null>(null);

export function OpenworkServerProvider(props: {
  store: OpenworkServerStore;
  children: ReactNode;
}) {
  return (
    <OpenworkServerContext.Provider value={props.store}>
      {props.children}
    </OpenworkServerContext.Provider>
  );
}

export function useOpenworkServer() {
  const store = use(OpenworkServerContext);
  if (!store) {
    throw new Error(
      `use${APP_NAME}Server must be used within an ${APP_NAME}ServerProvider`,
    );
  }

  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return store;
}
