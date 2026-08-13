import { create } from "zustand";
import type { ExpertDirectoryPageModel } from "./expert-directory-page-model";
import {
  expireExpertCreateOverlay,
  mergeExpertIdentityWithOverlay,
  sameExpertCreateOverlay,
  sameExpertIdentityIndex,
  type ExpertCreateOverlayEntry,
} from "./expert-create-overlay";

export type ExpertDirectoryDerivedStatus = ExpertDirectoryPageModel["state"];

export type ExpertDirectoryIdentityIndex = {
  sessionIds: ReadonlySet<string>;
  agentIdBySessionId: ReadonlyMap<string, string>;
};

const emptyIdentity: ExpertDirectoryIdentityIndex = {
  sessionIds: new Set<string>(),
  agentIdBySessionId: new Map<string, string>(),
};

type ExpertDirectoryStoreState = {
  statusByWorkspace: Record<string, ExpertDirectoryDerivedStatus>;
  identityByWorkspace: Record<string, ExpertDirectoryIdentityIndex>;
  overlayByWorkspace: Record<string, ExpertCreateOverlayEntry[]>;
  mergedByWorkspace: Record<string, ExpertDirectoryIdentityIndex>;
  setStatus: (workspaceId: string, status: ExpertDirectoryDerivedStatus) => void;
  getStatus: (workspaceId: string) => ExpertDirectoryDerivedStatus | null;
  setIdentity: (
    workspaceId: string,
    identity: ExpertDirectoryIdentityIndex | null,
  ) => void;
  upsertIdentity: (
    workspaceId: string,
    sessionId: string,
    agentId: string,
  ) => void;
  expireOverlay: (
    workspaceId: string,
    sessionIds: readonly string[],
  ) => void;
  getProjectionIdentity: (workspaceId: string) => ExpertDirectoryIdentityIndex;
  getIdentity: (workspaceId: string) => ExpertDirectoryIdentityIndex;
};

/**
 * Derived-only shadow status + projection identity copy.
 * setIdentity is Directory projection only; create-time bindings live in overlay.
 */
function resolveMergedIdentity(
  projection: ExpertDirectoryIdentityIndex,
  overlay: readonly ExpertCreateOverlayEntry[],
): ExpertDirectoryIdentityIndex {
  if (overlay.length === 0) return projection;
  return mergeExpertIdentityWithOverlay({
    sessionIds: projection.sessionIds,
    agentIdBySessionId: projection.agentIdBySessionId,
    overlay,
  });
}

export const useExpertDirectoryStore = create<ExpertDirectoryStoreState>((set, get) => ({
  statusByWorkspace: {},
  identityByWorkspace: {},
  overlayByWorkspace: {},
  mergedByWorkspace: {},
  setStatus: (workspaceId, status) => {
    const id = workspaceId.trim();
    if (!id) return;
    set((state) => ({
      statusByWorkspace: { ...state.statusByWorkspace, [id]: status },
    }));
  },
  getStatus: (workspaceId) => get().statusByWorkspace[workspaceId.trim()] ?? null,
  setIdentity: (workspaceId, identity) => {
    const id = workspaceId.trim();
    if (!id) return;
    const next = identity
      ? {
          sessionIds: new Set(identity.sessionIds),
          agentIdBySessionId: new Map(identity.agentIdBySessionId),
        }
      : emptyIdentity;
    set((state) => {
      const previous = state.identityByWorkspace[id] ?? emptyIdentity;
      const overlay = expireExpertCreateOverlay(state.overlayByWorkspace[id] ?? [], next.sessionIds);
      if (
        sameExpertIdentityIndex(previous, next) &&
        sameExpertCreateOverlay(state.overlayByWorkspace[id] ?? [], overlay)
      ) {
        return state;
      }
      const merged = resolveMergedIdentity(next, overlay);
      return {
        identityByWorkspace: { ...state.identityByWorkspace, [id]: next },
        overlayByWorkspace: { ...state.overlayByWorkspace, [id]: overlay },
        mergedByWorkspace: { ...state.mergedByWorkspace, [id]: merged },
      };
    });
  },
  upsertIdentity: (workspaceId, sessionId, agentId) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    const agent = agentId.trim();
    if (!workspace || !session || !agent) return;
    set((state) => {
      const projection = state.identityByWorkspace[workspace] ?? emptyIdentity;
      const currentOverlay = state.overlayByWorkspace[workspace] ?? [];
      if (projection.sessionIds.has(session)) {
        const overlay = expireExpertCreateOverlay(currentOverlay, projection.sessionIds);
        if (sameExpertCreateOverlay(currentOverlay, overlay)) return state;
        return {
          overlayByWorkspace: { ...state.overlayByWorkspace, [workspace]: overlay },
          mergedByWorkspace: {
            ...state.mergedByWorkspace,
            [workspace]: resolveMergedIdentity(projection, overlay),
          },
        };
      }
      const overlay = [
        ...currentOverlay.filter((entry) => entry.sessionId !== session),
        { sessionId: session, agentId: agent },
      ];
      if (sameExpertCreateOverlay(currentOverlay, overlay)) return state;
      return {
        overlayByWorkspace: { ...state.overlayByWorkspace, [workspace]: overlay },
        mergedByWorkspace: {
          ...state.mergedByWorkspace,
          [workspace]: resolveMergedIdentity(projection, overlay),
        },
      };
    });
  },
  expireOverlay: (workspaceId, sessionIds) => {
    const workspace = workspaceId.trim();
    if (!workspace) return;
    const drop = new Set(
      sessionIds.map((sessionId) => sessionId.trim()).filter(Boolean),
    );
    if (drop.size === 0) return;
    set((state) => {
      const currentOverlay = state.overlayByWorkspace[workspace] ?? [];
      const overlay = expireExpertCreateOverlay(currentOverlay, drop);
      if (sameExpertCreateOverlay(currentOverlay, overlay)) return state;
      const projection = state.identityByWorkspace[workspace] ?? emptyIdentity;
      return {
        overlayByWorkspace: { ...state.overlayByWorkspace, [workspace]: overlay },
        mergedByWorkspace: {
          ...state.mergedByWorkspace,
          [workspace]: resolveMergedIdentity(projection, overlay),
        },
      };
    });
  },
  getProjectionIdentity: (workspaceId) =>
    get().identityByWorkspace[workspaceId.trim()] ?? emptyIdentity,
  getIdentity: (workspaceId) => {
    const id = workspaceId.trim();
    return get().mergedByWorkspace[id]
      ?? get().identityByWorkspace[id]
      ?? emptyIdentity;
  },
}));
