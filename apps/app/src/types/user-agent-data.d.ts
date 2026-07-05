// User-Agent Client Hints — not yet in TypeScript's lib.dom.d.ts.
// See https://wicg.github.io/ua-client-hints/#navigatoruadata
export {}

declare global {
  interface NavigatorUAData {
    readonly platform: string
    readonly brands: ReadonlyArray<{ brand: string; version: string }>
    readonly mobile: boolean
    getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>>
    toJSON(): unknown
  }

  interface Navigator {
    readonly userAgentData?: NavigatorUAData
  }
}
