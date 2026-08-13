const TRANSIENT_PATTERNS = [
  /request timed out/i,
  /timed?\s*out/i,
  /falling back from websockets? to https/i,
  /websocket.*(?:closed|disconnect|unavailable|failed)/i,
  /https? transport.*(?:closed|disconnect|unavailable|failed)/i,
  /(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENETDOWN|ENETUNREACH|EAI_AGAIN)/i,
  /rate.?limit/i,
  /too many requests/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /ACP process exited/i,
  /ACP bridge interrupted/i,
  /ACP transport interrupted|stream disconnected before completion/i,
  /no observable progress/i,
  /task turn exceeded.*deadline/i,
];

const NON_RETRYABLE_PATTERNS = [
  /authentication|unauthenticated|not authenticated|invalid token|permission denied/i,
  /approval|rejected by user|declined/i,
  /context window|context length/i,
  /schema|validation|contract|acceptance criterion/i,
  /cancelled by user/i,
];

export function isTransientProviderFailure(error) {
  const message = String(error ?? "").trim();
  if (!message || NON_RETRYABLE_PATTERNS.some((pattern) => pattern.test(message))) return false;
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

export function retryBackoffMs(retryNumber) {
  const attempt = Math.max(1, Math.floor(Number(retryNumber) || 1));
  return Math.min(300_000, 1_000 * (2 ** Math.min(8, attempt - 1)));
}
