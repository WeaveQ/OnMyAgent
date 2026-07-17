/** Resume payload for opening a session-archive entry in the personal local-agent host. */
export type SessionArchiveResumeRequest = {
  agent: string;
  providerSessionId: string;
  project: string | null;
  sessionId: string;
  title: string;
};

/** Alias kept for callers that prefer domain-owned naming. */
export type PersonalLocalAgentArchiveResumeRequest = SessionArchiveResumeRequest;
