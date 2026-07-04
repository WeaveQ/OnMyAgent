export type AgentHealthResult = {
  status: "idle" | "running" | "passed" | "failed";
  at: number | null;
  runId: string | null;
  output: string;
  error: string | null;
};
