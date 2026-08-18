export type JsonRpcObject = Record<string, unknown>;

export declare function encodeJsonRpcMessage(message: JsonRpcObject): string;
export declare function parseJsonRpcMessage(line: string): JsonRpcObject | null;

export declare class BoundedJsonLineDecoder {
  constructor(options?: { maxLineBytes?: number });
  push(chunk: Buffer | string): string[];
  end(): string[];
}
