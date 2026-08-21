export type UpdateCheckStatusLike = {
  state?: string;
  message?: string;
  lastCheckedAt?: number | null;
} | null;

/** Manual check finished with no newer build and no error/soft notice. */
export function isUpToDateUpdateStatus(status: UpdateCheckStatusLike): boolean {
  return Boolean(
    status &&
      status.state === "idle" &&
      !status.message &&
      typeof status.lastCheckedAt === "number",
  );
}
