/** @jsxImportSource react */
import { useEffect, useReducer } from "react";

import {
  readReactRenderWatchdogSnapshot,
  resetReactRenderWatchdogStats,
} from "./react-render-watchdog";
import { t } from "../../i18n";

function readStoredPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("onmyagent.debug.renderOverlay") === "1";
  } catch {
    return false;
  }
}

function writeStoredPreference(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("onmyagent.debug.renderOverlay", value ? "1" : "0");
  } catch {
    // ignore
  }
}

type OverlayState = {
  visible: boolean;
  collapsed: boolean;
  snapshot: ReturnType<typeof readReactRenderWatchdogSnapshot>;
};

type OverlayAction =
  | { type: "toggleVisible" }
  | { type: "hide" }
  | { type: "toggleCollapsed" }
  | { type: "snapshot"; snapshot: ReturnType<typeof readReactRenderWatchdogSnapshot> };

const renderWatchdogOverlayClass = {
  shell: "pointer-events-auto fixed bottom-3 left-3 z-[1100] w-[320px] overflow-hidden rounded-lg border border-dls-border bg-dls-canvas/95 text-xs text-dls-text backdrop-blur-sm",
  header: "flex items-center justify-between border-b border-dls-border px-2.5 py-1.5",
  title: "font-mono text-xs text-dls-secondary",
  subtitle: "text-xs text-dls-secondary",
  actions: "flex items-center gap-1",
  button: "rounded px-1.5 py-0.5 text-xs text-dls-secondary hover:bg-dls-hover",
  body: "max-h-[50vh] overflow-y-auto",
  empty: "p-3 text-dls-secondary",
  table: "w-full border-collapse",
  tableHeader: "text-xs text-dls-secondary",
  thLeft: "px-2 py-1 text-left font-medium",
  thRight: "px-2 py-1 text-right font-medium",
};

function overlayReducer(state: OverlayState, action: OverlayAction): OverlayState {
  switch (action.type) {
    case "toggleVisible": {
      const visible = !state.visible;
      writeStoredPreference(visible);
      return { ...state, visible };
    }
    case "hide":
      writeStoredPreference(false);
      return { ...state, visible: false };
    case "toggleCollapsed":
      return { ...state, collapsed: !state.collapsed };
    case "snapshot":
      return { ...state, snapshot: action.snapshot };
  }
}

export function ReactRenderWatchdogOverlay() {
  const [state, dispatch] = useReducer(overlayReducer, undefined, () => ({
    visible: readStoredPreference(),
    collapsed: false,
    snapshot: readReactRenderWatchdogSnapshot(),
  }));
  const { visible, collapsed, snapshot } = state;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const metaOrCtrl = event.metaKey || event.ctrlKey;
      if (!metaOrCtrl || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "l") return;
      event.preventDefault();
      dispatch({ type: "toggleVisible" });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const tick = () => dispatch({ type: "snapshot", snapshot: readReactRenderWatchdogSnapshot() });
    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  const hot = snapshot.slice(0, 12);

  return (
    <div className={renderWatchdogOverlayClass.shell}>
      <div className={renderWatchdogOverlayClass.header}>
        <div>
          <div className={renderWatchdogOverlayClass.title}>
            render watchdog
          </div>
          <div className={renderWatchdogOverlayClass.subtitle}>
            hottest committed React surfaces
          </div>
        </div>
        <div className={renderWatchdogOverlayClass.actions}>
          <button
            type="button"
            className={renderWatchdogOverlayClass.button}
            onClick={() => {
              resetReactRenderWatchdogStats();
              dispatch({ type: "snapshot", snapshot: [] });
            }}
          >
            reset
          </button>
          <button
            type="button"
            className={renderWatchdogOverlayClass.button}
            onClick={() => dispatch({ type: "toggleCollapsed" })}
          >
            {collapsed ? "+" : "–"}
          </button>
          <button
            type="button"
            className={renderWatchdogOverlayClass.button}
            onClick={() => dispatch({ type: "hide" })}
            title={t("debug.hide_render_watchdog")}
          >
            ×
          </button>
        </div>
      </div>
      {collapsed ? null : (
        <div className={renderWatchdogOverlayClass.body}>
          {hot.length === 0 ? (
            <div className={renderWatchdogOverlayClass.empty}>
              No render samples yet. Interact with the app.
            </div>
          ) : (
            <table className={renderWatchdogOverlayClass.table}>
              <thead>
                <tr className={renderWatchdogOverlayClass.tableHeader}>
                  <th className={renderWatchdogOverlayClass.thLeft}>surface</th>
                  <th className={renderWatchdogOverlayClass.thRight}>2s</th>
                  <th className={renderWatchdogOverlayClass.thRight}>total</th>
                  <th className={renderWatchdogOverlayClass.thRight}>last</th>
                </tr>
              </thead>
              <tbody>
                {hot.map((item) => (
                  <tr key={item.name} className="border-t border-dls-border">
                    <td className="max-w-[160px] px-2 py-1 font-mono text-xs text-dls-text">
                      <span className="block truncate" title={item.name}>{item.name}</span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {item.windowCommits}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-dls-secondary">
                      {item.totalCommits}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-dls-secondary">
                      {Math.round(item.lastCommitAgeMs)}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className="border-t border-dls-border px-2.5 py-1 text-xs text-dls-secondary">
        Cmd+Shift+L toggles. Also available in window.__onmyagent.slice("reactRenderWatchdog").
      </div>
    </div>
  );
}
