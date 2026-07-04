/**
 * Bridging helpers for Node.js streams <-> Web streams.
 *
 * `Readable.toWeb()` returns a Node-typed stream that is structurally
 * compatible with the global `ReadableStream`, but TypeScript treats the two
 * as distinct. The helpers below centralize the `as unknown as` cast so
 * business code stays free of type escapes.
 */
import { Readable } from "node:stream";

export function nodeReadableToWebStream<T = Uint8Array>(
  readable: Readable,
): ReadableStream<T> {
  return Readable.toWeb(readable) as unknown as ReadableStream<T>;
}
