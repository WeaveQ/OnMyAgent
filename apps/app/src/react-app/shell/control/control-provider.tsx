/** @jsxImportSource react */
import {
  createContext,
  useCallback,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { t } from "../../../i18n";

export type OnMyAgentControlSideEffect = "none" | "navigation" | "mutation" | "external";

export type OnMyAgentControlActionArg = {
  name: string;
  type?: "string" | "number" | "boolean" | "object" | "array" | "unknown";
  required?: boolean;
  description?: string;
};

export type OnMyAgentControlActionMetadata = {
  id: string;
  label: string;
  description?: string;
  sideEffect: OnMyAgentControlSideEffect;
  requiresConfirmation: boolean;
  requiresArgs: boolean;
  hasPreviewArgs: boolean;
  previewArgs?: unknown;
  args?: OnMyAgentControlActionArg[];
  disabled: boolean;
  busy: boolean;
};

export type OnMyAgentControlSnapshot = {
  version: number;
  enabled: boolean;
  route: string;
  status: "off" | "ready" | "acting";
  busyActionId: string | null;
  narration: string;
  actions: OnMyAgentControlActionMetadata[];
};

export type OnMyAgentControlResult =
  | { ok: true; actionId: string; result?: unknown }
  | { ok: false; actionId: string; error: string };

export type OnMyAgentControlHelpers = {
  setNarration: (text: string) => void;
};

export type OnMyAgentControlTargetRef = {
  readonly current: HTMLElement | null;
};

export type OnMyAgentControlAction = {
  id: string;
  label: string;
  description?: string;
  sideEffect?: OnMyAgentControlSideEffect;
  requiresConfirmation?: boolean;
  requiresArgs?: boolean;
  args?: OnMyAgentControlActionArg[];
  previewArgs?: unknown;
  disabled?: boolean;
  targetRef?: OnMyAgentControlTargetRef;
  execute: (args: unknown, helpers: OnMyAgentControlHelpers) => unknown | Promise<unknown>;
};

type ControlActionRef = {
  readonly current: OnMyAgentControlAction | null;
};

type RegisteredAction = {
  id: string;
  order: number;
  token: symbol;
  ref: ControlActionRef;
};

type SpotlightState = {
  visible: boolean;
  phase: "target" | "press";
  rect: { x: number; y: number; width: number; height: number } | null;
};

type OnMyAgentControlContextValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  route: string;
  narration: string;
  busyActionId: string | null;
  actions: OnMyAgentControlActionMetadata[];
  registerAction: (actionId: string, actionRef: ControlActionRef) => () => void;
  executeAction: (actionId: string, args?: unknown) => Promise<OnMyAgentControlResult>;
  snapshot: () => OnMyAgentControlSnapshot;
};

type OnMyAgentControlAPI = {
  version: number;
  snapshot: () => OnMyAgentControlSnapshot;
  listActions: () => OnMyAgentControlActionMetadata[];
  execute: (actionId: string, args?: unknown) => Promise<OnMyAgentControlResult>;
  setEnabled: (enabled: boolean) => void;
  subscribe: (listener: (snapshot: OnMyAgentControlSnapshot) => void) => () => void;
};

declare global {
  interface Window {
    __onmyagentControl?: OnMyAgentControlAPI;
  }
}

const CONTROL_API_VERSION = 1;
const OnMyAgentControlContext = createContext<OnMyAgentControlContextValue | null>(null);
const SPOTLIGHT_TIMING_MS = Object.freeze({
  missingTarget: 80,
  scrollIntoView: 180,
  target: 260,
  press: 130,
  release: 80,
  done: 280,
});

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function returnedActionError(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const payload = result as { ok?: unknown; error?: unknown };
  if (payload.ok !== false) return null;
  return typeof payload.error === "string" && payload.error.trim()
    ? payload.error
    : t("system.action_returned_error");
}

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function metadataForAction(registered: RegisteredAction, busyActionId: string | null): OnMyAgentControlActionMetadata {
  const action = registered.ref.current;
  return {
    id: registered.id,
    label: action?.label ?? registered.id,
    description: action?.description,
    sideEffect: action?.sideEffect ?? "none",
    requiresConfirmation: action?.requiresConfirmation === true,
    requiresArgs: action?.requiresArgs === true,
    hasPreviewArgs: action?.previewArgs !== undefined,
    previewArgs: action?.previewArgs,
    args: action?.args,
    disabled: action?.disabled === true,
    busy: busyActionId === registered.id,
  };
}

function ControlModeSpotlight({ spotlight }: { spotlight: SpotlightState }) {
  const rect = spotlight.rect;
  if (!spotlight.visible || !rect) return null;

  const pad = spotlight.phase === "press" ? 8 : 12;
  return (
    <div
      className="pointer-events-none fixed z-[9998] rounded-xl bg-dls-accent/10 transition-all duration-200 ease-out"
      style={{
        left: `${rect.x - pad}px`,
        top: `${rect.y - pad}px`,
        width: `${rect.width + pad * 2}px`,
        height: `${rect.height + pad * 2}px`,
        transform: spotlight.phase === "press" ? "scale(0.985)" : "scale(1)",
      }}
    />
  );
}

export function OnMyAgentControlProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const actionsRef = useRef(new Map<string, RegisteredAction>());
  const listenersRef = useRef(new Set<(snapshot: OnMyAgentControlSnapshot) => void>());
  const nextOrderRef = useRef(1);
  const [version, setVersion] = useState(0);
  const [enabledState, setEnabledState] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [narration, setNarration] = useState(t("system.control_mode_off"));
  const [spotlight, setSpotlight] = useState<SpotlightState>({ visible: false, phase: "target", rect: null });
  const busyActionIdRef = useRef<string | null>(null);
  const spotlightRunRef = useRef(0);

  const route = `${location.pathname}${location.search}${location.hash}`;
  const enabled = enabledState;
  const status: OnMyAgentControlSnapshot["status"] = !enabled ? "off" : busyActionId ? "acting" : "ready";

  const setEnabled = useCallback((nextEnabled: boolean) => {
    setEnabledState(nextEnabled);
  }, []);

  const listActionMetadata = useCallback((nextBusyActionId = busyActionId) => {
    return Array.from(actionsRef.current.values())
      .sort((left, right) => left.order - right.order)
      .map((action) => metadataForAction(action, nextBusyActionId));
  }, [busyActionId, version]);

  const actions = useMemo(() => {
    return listActionMetadata();
  }, [listActionMetadata]);

  const snapshot = useCallback((): OnMyAgentControlSnapshot => ({
    version: CONTROL_API_VERSION,
    enabled,
    route,
    status,
    busyActionId,
    narration,
    actions: listActionMetadata(),
  }), [busyActionId, enabled, listActionMetadata, narration, route, status]);

  const registerAction = useCallback((actionId: string, actionRef: ControlActionRef) => {
    const token = Symbol(actionId);
    const previous = actionsRef.current.get(actionId);
    actionsRef.current.set(actionId, {
      id: actionId,
      order: previous?.order ?? nextOrderRef.current++,
      token,
      ref: actionRef,
    });
    setVersion((current) => current + 1);

    return () => {
      const current = actionsRef.current.get(actionId);
      if (current?.token === token) {
        actionsRef.current.delete(actionId);
        setVersion((value) => value + 1);
      }
    };
  }, []);

  const playTargetChoreography = useCallback(async (action: OnMyAgentControlAction, runId: number) => {
    if (!isBrowser()) return;
    const stillCurrent = () => spotlightRunRef.current === runId;
    const target = action.targetRef?.current;
    if (!target) {
      await wait(SPOTLIGHT_TIMING_MS.missingTarget);
      return;
    }

    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    await wait(SPOTLIGHT_TIMING_MS.scrollIntoView);
    if (!stillCurrent() || !target.isConnected) return;
    const rect = target.getBoundingClientRect();
    setSpotlight({
      visible: true,
      phase: "target",
      rect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
    });
    await wait(SPOTLIGHT_TIMING_MS.target);
    if (!stillCurrent()) return;
    setSpotlight((current) => ({ ...current, phase: "press" }));
    await wait(SPOTLIGHT_TIMING_MS.press);
    if (!stillCurrent()) return;
    setSpotlight((current) => ({ ...current, phase: "target" }));
    await wait(SPOTLIGHT_TIMING_MS.release);
  }, []);

  const executeAction = useCallback(async (actionId: string, args?: unknown): Promise<OnMyAgentControlResult> => {
    const registered = actionsRef.current.get(actionId);
    const action = registered?.ref.current;
    if (!registered || !action) return { ok: false, actionId, error: `Unknown action: ${actionId}` };
    if (action.disabled) return { ok: false, actionId, error: `Action is disabled: ${action.label}` };
    if (busyActionIdRef.current) return { ok: false, actionId, error: `Already acting: ${busyActionIdRef.current}` };

    if (action.requiresConfirmation && isBrowser()) {
      const confirmed = window.confirm(`Allow Control Mode to ${action.label}?`);
      if (!confirmed) return { ok: false, actionId, error: t("system.control_user_cancelled") };
    }

    const runId = spotlightRunRef.current + 1;
    spotlightRunRef.current = runId;
    busyActionIdRef.current = action.id;
    setEnabled(true);
    setBusyActionId(action.id);
    setNarration(`Moving to ${action.label}…`);

    try {
      await playTargetChoreography(action, runId);
      setNarration(`Running ${action.label}…`);
      const effectiveArgs = args === undefined ? action.previewArgs : args;
      const result = await action.execute(effectiveArgs, { setNarration });
      const resultError = returnedActionError(result);
      if (resultError) {
        setNarration(`Could not ${action.label}: ${resultError}`);
        if (spotlightRunRef.current === runId) {
          setSpotlight({ visible: false, phase: "target", rect: null });
        }
        return { ok: false, actionId, error: resultError };
      }
      setNarration(`Done: ${action.label}`);
      await wait(SPOTLIGHT_TIMING_MS.done);
      if (spotlightRunRef.current === runId) {
        setSpotlight({ visible: false, phase: "target", rect: null });
      }
      return { ok: true, actionId, result };
    } catch (error) {
      const message = describeError(error);
      setNarration(`Could not ${action.label}: ${message}`);
      if (spotlightRunRef.current === runId) {
        setSpotlight({ visible: false, phase: "target", rect: null });
      }
      return { ok: false, actionId, error: message };
    } finally {
      if (busyActionIdRef.current === action.id) busyActionIdRef.current = null;
      setBusyActionId(null);
    }
  }, [playTargetChoreography, setEnabled]);

  const value = useMemo<OnMyAgentControlContextValue>(() => ({
    enabled,
    setEnabled,
    route,
    narration,
    busyActionId,
    actions,
    registerAction,
    executeAction,
    snapshot,
  }), [actions, busyActionId, enabled, executeAction, narration, registerAction, route, setEnabled, snapshot]);

  useEffect(() => {
    if (!enabled) {
      setNarration(t("system.control_mode_off"));
    } else if (narration === t("system.control_mode_off")) {
      setNarration(t("system.control_ready"));
    }
  }, [enabled, narration]);

  useEffect(() => {
    if (!isBrowser()) return;

    const api: OnMyAgentControlAPI = {
      version: CONTROL_API_VERSION,
      snapshot,
      listActions: () => snapshot().actions,
      execute: executeAction,
      setEnabled,
      subscribe(listener) {
        listenersRef.current.add(listener);
        listener(snapshot());
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    };

    window.__onmyagentControl = api;
    return () => {
      if (window.__onmyagentControl === api) {
        delete window.__onmyagentControl;
      }
    };
  }, [executeAction, setEnabled, snapshot]);

  useEffect(() => {
    busyActionIdRef.current = busyActionId;
  }, [busyActionId]);

  useEffect(() => {
    const next = snapshot();
    listenersRef.current.forEach((listener) => listener(next));
  }, [snapshot, version]);

  return (
    <OnMyAgentControlContext.Provider value={value}>
      {children}
      <ControlModeSpotlight spotlight={spotlight} />
    </OnMyAgentControlContext.Provider>
  );
}

export function useOnMyAgentControl() {
  return use(OnMyAgentControlContext);
}

export function useControlAction(action: OnMyAgentControlAction | null | false | undefined) {
  const control = useOnMyAgentControl();
  const registerAction = control?.registerAction;
  const latestActionRef = useRef<OnMyAgentControlAction | null>(action || null);
  latestActionRef.current = action || null;
  const actionId = action ? action.id : null;

  useEffect(() => {
    if (!registerAction || !actionId) return undefined;
    return registerAction(actionId, latestActionRef);
  }, [actionId, registerAction]);
}

function settingsNavStateFromLocation(pathname: string, search: string) {
  const workspaceMatch = pathname.match(/^\/workspace\/([^/]+)\//);
  const workspaceId = workspaceMatch
    ? decodeURIComponent(workspaceMatch[1])
    : "";
  const sessionMatch = pathname.match(/\/(?:assistant|session)\/([^/]+)/);
  const sessionId = sessionMatch ? decodeURIComponent(sessionMatch[1]) : null;
  return {
    workspaceId,
    sessionId,
    pageMode: (pathname.includes("/assistant")
      ? "assistant"
      : "expert") as "assistant" | "expert",
    returnTo: `${pathname}${search}`,
  };
}

export function OnMyAgentRouteControlActions() {
  const navigate = useNavigate();
  const location = useLocation();

  const actions = useMemo<OnMyAgentControlAction[]>(() => {
    const openSettingsTab = (tab: string) => {
      if (location.pathname.includes("/settings")) {
        navigate(
          location.pathname.includes("/workspace/")
            ? location.pathname.replace(/\/settings\/.*$/, `/settings/${tab}`)
            : `/settings/${tab}`,
          { replace: true, state: location.state },
        );
        return;
      }
      const state = settingsNavStateFromLocation(
        location.pathname,
        location.search,
      );
      const target = state.workspaceId
        ? `/workspace/${encodeURIComponent(state.workspaceId)}/settings/${tab}`
        : `/settings/${tab}`;
      navigate(target, { state });
    };

    return [
    {
      id: "route.session",
      label: t("system.control_open_sessions"),
      description: t("system.control_open_sessions_desc"),
      sideEffect: "navigation",
      execute: () => navigate("/session"),
    },
    {
      id: "route.settings.general",
      label: t("system.control_open_general_settings"),
      description: t("system.control_open_general_settings_desc"),
      sideEffect: "navigation",
      execute: () => openSettingsTab("general"),
    },
    {
      id: "route.settings.providers",
      label: t("system.control_open_provider_settings"),
      description: t("system.control_open_ai_settings_desc"),
      sideEffect: "navigation",
      execute: () => openSettingsTab("ai"),
    },
    {
      id: "route.settings.authorized_folders",
      label: t("system.control_open_folders_settings"),
      description: t("system.control_open_folders_settings_desc"),
      sideEffect: "navigation",
      execute: () => openSettingsTab("permissions"),
    },
  ];
  }, [location.pathname, location.search, location.state, navigate]);

  useControlAction(actions[0]);
  useControlAction(actions[1]);
  useControlAction(actions[2]);
  useControlAction(actions[3]);
  useControlAction(actions[4]);
  return null;
}
