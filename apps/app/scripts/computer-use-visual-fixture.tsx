/** @jsxImportSource react */
import { createRoot } from "react-dom/client";

import "../src/app/index.css";
import { setLocale } from "../src/i18n";
import { ComputerUseConfig } from "../src/react-app/domains/settings/computer-use-config";

type FixtureState = "missing" | "ready" | "running" | "paused" | "mismatch";

function resolveFixtureState(value: string | null): FixtureState {
  if (value === "missing" || value === "running" || value === "paused" || value === "mismatch") {
    return value;
  }
  return "ready";
}

const params = new URLSearchParams(window.location.search);
const state = resolveFixtureState(params.get("state"));
const locale = params.get("lang");
if (locale === "en" || locale === "zh" || locale === "zh-TW") setLocale(locale);
if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
  document.documentElement.dataset.theme = "dark";
}

let skysightEnabled = state === "running" || state === "paused";
let skysightPaused = state === "paused";
let skysightExclusions: Array<{
  scope: "app" | "website" | "private_browsing";
  value?: string;
}> = [
  { scope: "private_browsing" },
  { scope: "app", value: "com.tinyspeck.slackmacgap" },
  { scope: "website", value: "example.com" },
];
let allowedBundleIdentifiers = state === "missing"
  ? []
  : ["com.apple.Safari", "com.apple.dt.Xcode"];

function statusPayload() {
  const missing = state === "missing";
  const mismatch = state === "mismatch";
  return {
    ok: !missing,
    accessibility: !missing,
    screenRecording: !missing,
    helperVersion: mismatch ? "0.0.9" : "0.1.0",
    desktopVersion: "0.1.0",
    protocolVersion: mismatch ? 2 : 1,
    activity: state === "running"
      ? { phase: "running", app: "Safari" }
      : state === "paused"
        ? { phase: "paused", app: "Safari", reason: "physical_input" }
        : { phase: "ready" },
    skysight: {
      enabled: skysightEnabled,
      paused: skysightPaused,
      retentionDays: 30,
      recording: skysightEnabled && !skysightPaused,
      exclusions: skysightExclusions,
    },
    appAuthorizations: {
      version: 1,
      allowedBundleIdentifiers,
    },
  };
}

window.__ONMYAGENT_ELECTRON__ = {
  invokeDesktop: async (command, ...args) => {
    if (command === "setComputerUseSkysightEnabled") {
      skysightEnabled = args[0] === true;
      return statusPayload();
    }
    if (command === "setComputerUseSkysightPaused") {
      skysightPaused = args[0] === true;
      return statusPayload();
    }
    if (command === "updateComputerUseSkysightExclusion") {
      const operation = args[0];
      const scope = args[1];
      const value = typeof args[2] === "string" ? args[2] : undefined;
      if (scope === "app" || scope === "website" || scope === "private_browsing") {
        const matches = (entry: (typeof skysightExclusions)[number]) =>
          entry.scope === scope && entry.value === value;
        if (operation === "add" && !skysightExclusions.some(matches)) {
          skysightExclusions = [...skysightExclusions, { scope, value }];
        }
        if (operation === "remove") {
          skysightExclusions = skysightExclusions.filter((entry) => !matches(entry));
        }
      }
      return statusPayload();
    }
    if (command === "clearComputerUseSkysightData") return { ok: true };
    if (command === "revokeComputerUseAppAuthorization") {
      allowedBundleIdentifiers = allowedBundleIdentifiers.filter(
        (identifier) => identifier !== args[0],
      );
      return statusPayload();
    }
    if (command === "clearComputerUseAppAuthorizations") {
      allowedBundleIdentifiers = [];
      return statusPayload();
    }
    return statusPayload();
  },
};

const root = document.getElementById("root");
if (!root) throw new Error("Missing Computer Use visual fixture root");

createRoot(root).render(
  <main
    className="min-h-screen bg-dls-app-bg px-6 py-8 text-dls-text"
    data-computer-use-fixture={state}
  >
    <div className="mx-auto w-full max-w-4xl">
      <ComputerUseConfig
        connected={state !== "missing"}
        connecting={false}
        onConnect={() => undefined}
        onRefresh={() => undefined}
      />
    </div>
  </main>,
);
