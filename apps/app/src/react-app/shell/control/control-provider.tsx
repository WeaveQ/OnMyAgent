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

export type OpenworkControlSideEffect = "none" | "navigation" | "mutation" | "external";

export type OpenworkControlActionArg = {
  name: string;
  type?: "string" | "number" | "boolean" | "object" | "array" | "unknown";
  required?: boolean;
  description?: string;
};

export type OpenworkControlActionMetadata = {
  id: string;
  label: string;
  description?: string;
  sideEffect: OpenworkControlSideEffect;
  requiresConfirmation: boolean;
  requiresArgs: boolean;
  hasPreviewArgs: boolean;
  previewArgs?: unknown;
  args?: OpenworkControlActionArg[];
  disabled: boolean;
  busy: boolean;
};

export type OpenworkControlSnapshot = {
  version: number;
  enabled: boolean;
  route: string;
  status: "off" | "ready" | "acting";
  busyActionId: string | null;
  narration: string;
  actions: OpenworkControlActionMetadata[];
};

export type OpenworkControlResult =
  | { ok: true; actionId: string; result?: unknown }
  | { ok: false; actionId: string; error: string };

export type OpenworkControlHelpers = {
  setNarration: (text: string) => void;
};

export type OpenworkControlTargetRef = {
  readonly current: HTMLElement | null;
};

export type OpenworkControlAction = {
  id: string;
  label: string;
  description?: string;
  sideEffect?: OpenworkControlSideEffect;
  requiresConfirmation?: boolean;
  requiresArgs?: boolean;
  args?: OpenworkControlActionArg[];
  previewArgs?: unknown;
  disabled?: boolean;
  targetRef?: OpenworkControlTargetRef;
  execute: (args: unknown, helpers: OpenworkControlHelpers) => unknown | Promise<unknown>;
};

type ControlActionRef = {
  readonly current: OpenworkControlAction | null;
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

type OpenworkControlContextValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  route: string;
  narration: string;
  busyActionId: string | null;
  actions: OpenworkControlActionMetadata[];
  registerAction: (actionId: string, actionRef: ControlActionRef) => () => void;
  executeAction: (actionId: string, args?: unknown) => Promise<OpenworkControlResult>;
  snapshot: () => OpenworkControlSnapshot;
};

type OpenworkControlAPI = {
  version: number;
  snapshot: () => OpenworkControlSnapshot;
  listActions: () => OpenworkControlActionMetadata[];
  execute: (actionId: string, args?: unknown) => Promise<OpenworkControlResult>;
  setEnabled: (enabled: boolean) => void;
  subscribe: (listener: (snapshot: OpenworkControlSnapshot) => void) => () => void;
};

declare global {
  interface Window {
    __onmyagentControl?: OpenworkControlAPI;
  }
}

const CONTROL_API_VERSION = 1;
const OpenworkControlContext = createContext<OpenworkControlContextValue | null>(null);
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

function metadataForAction(registered: RegisteredAction, busyActionId: string | null): OpenworkControlActionMetadata {
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

export function OpenworkControlProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const actionsRef = useRef(new Map<string, RegisteredAction>());
  const listenersRef = useRef(new Set<(snapshot: OpenworkControlSnapshot) => void>());
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
  const status: OpenworkControlSnapshot["status"] = !enabled ? "off" : busyActionId ? "acting" : "ready";

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

  const snapshot = useCallback((): OpenworkControlSnapshot => ({
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

  const playTargetChoreography = useCallback(async (action: OpenworkControlAction, runId: number) => {
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

  const executeAction = useCallback(async (actionId: string, args?: unknown): Promise<OpenworkControlResult> => {
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

  const value = useMemo<OpenworkControlContextValue>(() => ({
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

    const api: OpenworkControlAPI = {
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
    <OpenworkControlContext.Provider value={value}>
      {children}
      <ControlModeSpotlight spotlight={spotlight} />
    </OpenworkControlContext.Provider>
  );
}

export function useOpenworkControl() {
  return use(OpenworkControlContext);
}

export function useControlAction(action: OpenworkControlAction | null | false | undefined) {
  const control = useOpenworkControl();
  const registerAction = control?.registerAction;
  const latestActionRef = useRef<OpenworkControlAction | null>(action || null);
  latestActionRef.current = action || null;
  const actionId = action ? action.id : null;

  useEffect(() => {
    if (!registerAction || !actionId) return undefined;
    return registerAction(actionId, latestActionRef);
  }, [actionId, registerAction]);
}

export function OpenworkRouteControlActions() {
  const navigate = useNavigate();

  const actions = useMemo<OpenworkControlAction[]>(() => [
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
      execute: () => navigate("/settings/general"),
    },
    {
      id: "route.settings.extensions",
      label: t("system.control_open_extensions_settings"),
      description: t("system.control_open_extensions_settings_desc"),
      sideEffect: "navigation",
      execute: () => navigate("/settings/extensions"),
    },
    {
      id: "route.settings.skills",
      label: t("system.control_open_skills_settings"),
      description: t("system.control_open_skills_settings_desc"),
      sideEffect: "navigation",
      execute: () => navigate("/settings/skills"),
    },
    {
      id: "route.settings.providers",
      label: t("system.control_open_provider_settings"),
      description: t("system.control_open_ai_settings_desc"),
      sideEffect: "navigation",
      execute: () => navigate("/settings/ai"),
    },
    {
      id: "route.settings.authorized_folders",
      label: t("system.control_open_folders_settings"),
      description: t("system.control_open_folders_settings_desc"),
      sideEffect: "navigation",
      execute: () => navigate("/settings/permissions"),
    },
  ], [navigate]);

  useControlAction(actions[0]);
  useControlAction(actions[1]);
  useControlAction(actions[2]);
  useControlAction(actions[3]);
  useControlAction(actions[4]);
  useControlAction(actions[5]);
  useControlAction(actions[6]);
  return null;
}
