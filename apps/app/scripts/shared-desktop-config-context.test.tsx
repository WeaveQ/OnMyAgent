import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";

import {
  DesktopConfigContext,
  useCheckDesktopRestriction,
  useDesktopConfig,
  useDesktopRestriction,
  useOrgRestrictions,
  type DesktopConfigStore,
} from "../src/react-app/domains/shared/desktop-config-context";

function DesktopConfigProbe() {
  const desktopConfig = useDesktopConfig();
  const restrictions = useOrgRestrictions();
  const checkRestriction = useCheckDesktopRestriction();
  const builtInExtensionsDisabled = useDesktopRestriction("allowBuiltInExtensions");

  return (
    <pre>
      {JSON.stringify({
        loading: desktopConfig.loading,
        allowZenModel: restrictions.allowZenModel,
        allowBuiltInExtensions: checkRestriction({ restriction: "allowBuiltInExtensions" }),
        builtInExtensionsDisabled,
      })}
    </pre>
  );
}

describe("shared desktop config context", () => {
  test("shares desktop restriction hooks outside the cloud domain", () => {
    const store = {
      config: { allowZenModel: true, allowBuiltInExtensions: false },
      loading: false,
      refresh: async () => undefined,
      checkRestriction: ({ restriction }) => restriction === "allowBuiltInExtensions",
    } satisfies DesktopConfigStore;

    const html = renderToString(
      <DesktopConfigContext.Provider value={store}>
        <DesktopConfigProbe />
      </DesktopConfigContext.Provider>,
    );

    expect(html).toContain('&quot;loading&quot;:false');
    expect(html).toContain('&quot;allowZenModel&quot;:true');
    expect(html).toContain('&quot;allowBuiltInExtensions&quot;:true');
    expect(html).toContain('&quot;builtInExtensionsDisabled&quot;:true');
  });

  test("throws when hooks are used without a provider", () => {
    expect(() => renderToString(<DesktopConfigProbe />)).toThrow(
      "useDesktopConfig must be used within a DesktopConfigProvider",
    );
  });
});
