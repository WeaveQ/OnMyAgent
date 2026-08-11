import { create } from "zustand";
import type { ExpertDirectoryPageModel } from "./expert-directory-page-model";

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
  getIdentity: (workspaceId: string) => ExpertDirectoryIdentityIndex;
};

/**
 * Derived-only shadow status. The server projection remains owned by
 * TanStack Query; this store intentionally has no records/session payload.
 */
export const useExpertDirectoryStore = create<ExpertDirectoryStoreState>((set, get) => ({
  statusByWorkspace: {},
  identityByWorkspace: {},
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
    set((state) => ({
      identityByWorkspace: { ...state.identityByWorkspace, [id]: next },
    }));
  },
  upsertIdentity: (workspaceId, sessionId, agentId) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    const agent = agentId.trim();
    if (!workspace || !session || !agent) return;
    set((state) => {
      const current = state.identityByWorkspace[workspace] ?? emptyIdentity;
      const sessionIds = new Set(current.sessionIds);
      const agentIdBySessionId = new Map(current.agentIdBySessionId);
      sessionIds.add(session);
      agentIdBySessionId.set(session, agent);
      return {
        identityByWorkspace: {
          ...state.identityByWorkspace,
          [workspace]: { sessionIds, agentIdBySessionId },
        },
      };
    });
  },
  getIdentity: (workspaceId) =>
    get().identityByWorkspace[workspaceId.trim()] ?? emptyIdentity,
}));
