/**
 * Typed-ish errors for managed CLI installers.
 * Callers may set a product-specific default code via errorCode(fallback).
 */

/**
 * @param {string} message
 * @param {string} [code]
 * @returns {Error & { code?: string }}
 */
export function codedError(message, code) {
  /** @type {Error & { code?: string }} */
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

/**
 * @param {unknown} error
 * @param {string} [fallback]
 * @returns {string}
 */
export function errorCode(error, fallback = "managed_cli_error") {
  if (error && typeof error === "object" && "code" in error) {
    return typeof error.code === "string" ? error.code : fallback;
  }
  return fallback;
}
