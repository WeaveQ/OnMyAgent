/**
 * Shared download + integrity helpers for managed remote CLIs
 * (OfficeCLI, Feishu/lark-cli, future Tencent docs CLI, …).
 *
 * Does not own plugin state / skill install — only network + hash + stream.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";

import { codedError } from "./errors.mjs";

export const MANAGED_CLI_NETWORK_TIMEOUT_MS = 30_000;
export const MANAGED_CLI_NETWORK_RETRY_COUNT = 2;

/**
 * Strip query/hash from URLs before putting them in error messages.
 * @param {unknown} value
 * @param {string} [fallback]
 */
export function safeDownloadTarget(value, fallback = "managed CLI resource") {
  const text = String(value);
  try {
    const url = new URL(text);
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return text.split(/[?#]/, 1)[0] || fallback;
  }
}

/**
 * @param {number} size actual byte length
 * @param {string} digest hex sha256
 * @param {{ size?: number, sha256: string }} expected
 * @param {string} label
 */
export function verifyDigest(size, digest, expected, label) {
  // size is optional in catalog — only enforce when publisher provided it.
  if (typeof expected.size === "number" && size !== expected.size) {
    throw codedError(`${label} size mismatch`, "integrity_mismatch");
  }
  if (
    typeof expected.sha256 !== "string" ||
    digest.toLowerCase() !== expected.sha256.toLowerCase()
  ) {
    throw codedError(`${label} checksum mismatch`, "integrity_mismatch");
  }
  return digest;
}

/**
 * @param {Buffer | Uint8Array} bytes
 * @param {{ size?: number, sha256: string }} expected
 * @param {string} label
 */
export function verifyBytes(bytes, expected, label) {
  return verifyDigest(
    bytes.byteLength,
    createHash("sha256").update(bytes).digest("hex"),
    expected,
    label,
  );
}

/** @param {Buffer | Uint8Array} bytes */
export function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * @param {string} target
 * @param {number} maximum
 * @param {string} label
 * @returns {Promise<{ size: number, sha256: string }>}
 */
export async function hashFile(target, maximum, label) {
  const stream = createReadStream(target);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > maximum) {
      stream.destroy();
      throw codedError(`${label} exceeds size limit`, "integrity_mismatch");
    }
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex") };
}

/**
 * Verify when expected.sha256 is present; otherwise only return actual digest.
 * @param {Buffer | Uint8Array} bytes
 * @param {{ size?: number, sha256?: string } | null | undefined} expected
 * @param {string} label
 */
export function verifyOptionalBytes(bytes, expected, label) {
  if (!expected || typeof expected !== "object") return digestBytes(bytes);
  if (typeof expected.sha256 !== "string") {
    return digestBytes(bytes);
  }
  return verifyBytes(bytes, /** @type {{ size?: number, sha256: string }} */ (expected), label);
}

/**
 * @param {string} digest
 * @param {string} expected
 * @param {string} label
 */
export function verifyHash(digest, expected, label) {
  if (digest.toLowerCase() !== String(expected).toLowerCase()) {
    throw codedError(`${label} checksum mismatch`, "integrity_mismatch");
  }
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryableError(error) {
  return error instanceof Error;
}

function waitForRetry(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Bound downloader for one product (timeouts, retries, error label prefix).
 *
 * @param {{
 *   label?: string,
 *   networkTimeoutMs?: number,
 *   networkRetryCount?: number,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 */
export function createManagedCliDownloader(options = {}) {
  const productLabel = String(options.label ?? "ManagedCLI");
  const networkTimeoutMs = Number.isFinite(Number(options.networkTimeoutMs))
    ? Math.max(1, Number(options.networkTimeoutMs))
    : MANAGED_CLI_NETWORK_TIMEOUT_MS;
  const networkRetryCount = Number.isInteger(Number(options.networkRetryCount))
    ? Math.max(0, Number(options.networkRetryCount))
    : MANAGED_CLI_NETWORK_RETRY_COUNT;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  function safeTarget(value) {
    return safeDownloadTarget(value, `${productLabel} resource`);
  }

  function networkError(error, url) {
    if (error?.name === "AbortError") {
      return codedError(
        `${productLabel} request timed out: ${safeTarget(url)}`,
        "network_timeout",
      );
    }
    return error;
  }

  /**
   * @param {ReadableStreamDefaultReader<Uint8Array>} reader
   * @param {number} timeoutMs
   * @param {string} label
   */
  async function readStreamChunk(reader, timeoutMs, label) {
    const safeLabel = safeTarget(label);
    let timeout = null;
    try {
      return await Promise.race([
        reader.read(),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                codedError(
                  `${productLabel} response timed out: ${safeLabel}`,
                  "network_timeout",
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * @param {string} url
   * @returns {Promise<Response>}
   */
  async function fetchWithRetry(url) {
    if (typeof fetchImpl !== "function") {
      throw new Error(`${productLabel} network fetch is unavailable`);
    }
    let lastError = null;
    for (let attempt = 0; attempt <= networkRetryCount; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), networkTimeoutMs);
      try {
        const response = await fetchImpl(url, {
          redirect: "error",
          signal: controller.signal,
        });
        if (retryableStatus(response.status) && attempt < networkRetryCount) {
          await response.body?.cancel();
          await waitForRetry(100 * (attempt + 1));
          continue;
        }
        return response;
      } catch (error) {
        lastError = networkError(error, url);
        if (attempt >= networkRetryCount || !retryableError(lastError)) {
          throw lastError;
        }
        await waitForRetry(100 * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw (
      lastError ??
      new Error(`${productLabel} request failed: ${safeTarget(url)}`)
    );
  }

  /**
   * @param {Response} response
   * @param {number} maximum
   * @param {string} url
   * @param {(receivedBytes: number, totalBytes: number | undefined) => void} [onProgress]
   * @param {number} [timeoutMs]
   */
  async function responseBytes(
    response,
    maximum,
    url,
    onProgress = () => undefined,
    timeoutMs = networkTimeoutMs,
  ) {
    const safeUrl = safeTarget(url);
    if (!response.ok) {
      throw new Error(
        `${productLabel} download failed (${response.status}): ${safeUrl}`,
      );
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > maximum) {
      throw new Error(`${productLabel} response exceeds size limit: ${safeUrl}`);
    }
    if (!response.body) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > maximum) {
        throw new Error(`${productLabel} response exceeds size limit: ${safeUrl}`);
      }
      onProgress(bytes.byteLength, contentLength || undefined);
      return bytes;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let receivedBytes = 0;
    try {
      while (true) {
        const next = await readStreamChunk(reader, timeoutMs, url);
        if (next.done) break;
        const chunk = Buffer.from(next.value);
        receivedBytes += chunk.byteLength;
        if (receivedBytes > maximum) {
          await reader.cancel();
          throw new Error(
            `${productLabel} response exceeds size limit: ${safeUrl}`,
          );
        }
        chunks.push(chunk);
        onProgress(receivedBytes, contentLength || undefined);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
    return Buffer.concat(chunks, receivedBytes);
  }

  /**
   * @param {Response} response
   * @param {string} target
   * @param {number} maximum
   * @param {{ size?: number, sha256: string } | undefined} expected
   * @param {string} label
   * @param {(receivedBytes: number, totalBytes: number | undefined) => void} [onProgress]
   * @param {number} [timeoutMs]
   */
  async function streamResponseToFile(
    response,
    target,
    maximum,
    expected,
    label,
    onProgress = () => undefined,
    timeoutMs = networkTimeoutMs,
  ) {
    if (!response.ok) {
      throw new Error(
        `${productLabel} download failed (${response.status}): ${label}`,
      );
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > maximum) {
      throw new Error(`${productLabel} response exceeds size limit: ${label}`);
    }
    if (!response.body) {
      throw new Error(
        `${productLabel} streaming response is unavailable: ${label}`,
      );
    }

    const reader = response.body.getReader();
    const file = await open(target, "w");
    const hash = createHash("sha256");
    let receivedBytes = 0;
    try {
      while (true) {
        const next = await readStreamChunk(reader, timeoutMs, label);
        if (next.done) break;
        const chunk = Buffer.from(next.value);
        receivedBytes += chunk.byteLength;
        if (receivedBytes > maximum) {
          await reader.cancel();
          throw new Error(
            `${productLabel} response exceeds size limit: ${label}`,
          );
        }
        hash.update(chunk);
        await file.write(chunk);
        onProgress(receivedBytes, contentLength || undefined);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      await file.close();
    }
    const digest = hash.digest("hex");
    if (expected) verifyDigest(receivedBytes, digest, expected, label);
    return { receivedBytes, digest };
  }

  /**
   * @param {string} url
   * @param {number} maximum
   */
  async function fetchJson(url, maximum) {
    const response = await fetchWithRetry(url);
    const bytes = await responseBytes(
      response,
      maximum,
      url,
      () => undefined,
      networkTimeoutMs,
    );
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  }

  /**
   * Download a zip (or raw) URL to `destPath`, optionally verifying sha256 of the file bytes.
   * For zip binaries that need extract-then-hash, download without expected and verify after extract.
   *
   * @param {{
   *   url: string,
   *   destPath: string,
   *   maximum: number,
   *   expected?: { size?: number, sha256: string },
   *   label: string,
   *   onProgress?: (receivedBytes: number, totalBytes: number | undefined) => void,
   * }} input
   */
  async function downloadToFile(input) {
    const response = await fetchWithRetry(input.url);
    return streamResponseToFile(
      response,
      input.destPath,
      input.maximum,
      input.expected,
      input.label,
      input.onProgress ?? (() => undefined),
      networkTimeoutMs,
    );
  }

  return {
    productLabel,
    networkTimeoutMs,
    networkRetryCount,
    fetchWithRetry,
    fetchJson,
    responseBytes,
    streamResponseToFile,
    downloadToFile,
    safeDownloadTarget: safeTarget,
  };
}
