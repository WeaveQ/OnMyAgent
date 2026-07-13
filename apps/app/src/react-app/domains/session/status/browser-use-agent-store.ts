import { create } from "zustand";

type BrowserUseAgentRunStore = {
  runIdsBySession: Record<string, string>;
  setRun: (sessionId: string, runId: string | null) => void;
};

export const useBrowserUseAgentRunStore = create<BrowserUseAgentRunStore>((set) => ({
  runIdsBySession: {},
  setRun: (sessionId, runId) => set((state) => {
    const next = { ...state.runIdsBySession };
    if (runId) next[sessionId] = runId;
    else delete next[sessionId];
    return { runIdsBySession: next };
  }),
}));

export function setBrowserUseAgentRun(sessionId: string, runId: string | null): void {
  useBrowserUseAgentRunStore.getState().setRun(sessionId, runId);
}
