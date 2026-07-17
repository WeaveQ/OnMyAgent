import { useEffect, useRef } from "react";

import type { SidebarSessionItem } from "../../../app/types";
import type { RouteWorkspace } from "./model";

export type SessionLocalServerRefValue = {
  baseUrl: string;
  token: string;
};

export function clearSessionLocalServerRef(ref: { current: SessionLocalServerRefValue }) {
  ref.current = { baseUrl: "", token: "" };
}

export function writeSessionLocalServerRef(
  ref: { current: SessionLocalServerRefValue },
  value: SessionLocalServerRefValue,
) {
  ref.current = value;
}

export function useSessionRouteRefs(input: {
  baseUrl: string;
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
  token: string;
  workspaces: RouteWorkspace[];
  workspaceOrderIds: string[];
}) {
  const localServerRef = useRef<SessionLocalServerRefValue>({
    baseUrl: input.baseUrl,
    token: input.token,
  });
  const workspacesRef = useRef<RouteWorkspace[]>(input.workspaces);
  const workspaceOrderIdsRef = useRef(input.workspaceOrderIds);
  const sessionsByWorkspaceIdRef = useRef<Record<string, SidebarSessionItem[]>>(
    input.sessionsByWorkspaceId,
  );

  useEffect(() => {
    writeSessionLocalServerRef(localServerRef, { baseUrl: input.baseUrl, token: input.token });
  }, [input.baseUrl, input.token]);

  useEffect(() => {
    workspacesRef.current = input.workspaces;
  }, [input.workspaces]);

  useEffect(() => {
    workspaceOrderIdsRef.current = input.workspaceOrderIds;
  }, [input.workspaceOrderIds]);

  useEffect(() => {
    sessionsByWorkspaceIdRef.current = input.sessionsByWorkspaceId;
  }, [input.sessionsByWorkspaceId]);

  return {
    localServerRef,
    sessionsByWorkspaceIdRef,
    workspacesRef,
    workspaceOrderIdsRef,
  };
}
