import { openInEditor } from "../../app/lib/desktop";

const sourceAttribute = "data-oma-source";

type OpenSourceResult = Awaited<ReturnType<typeof openInEditor>>;

declare global {
  interface Window {
    openElementInEditor?: (target?: Element | null) => Promise<OpenSourceResult>;
  }
}

function parseSource(value: string) {
  const match = value.match(/^(.*?):(\d+)(?::(\d+))?$/);
  if (!match) return { path: value };
  return {
    path: match[1] ?? value,
    line: Number(match[2]),
    column: match[3] ? Number(match[3]) : undefined,
  };
}

function findSourceElement(target: EventTarget | Element | null | undefined) {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${sourceAttribute}]`);
}

async function openElementSource(target?: Element | null) {
  const element = findSourceElement(target ?? null);
  const source = element?.getAttribute(sourceAttribute);
  if (!source) {
    return { ok: false, reason: "No data-oma-source attribute found on this element." };
  }
  const parsed = parseSource(source);
  return openInEditor(parsed.path, parsed.line, parsed.column);
}

export function installDevSourceInspector() {
  if (!import.meta.env.DEV) return;
  if (typeof window === "undefined") return;
  if (window.openElementInEditor) return;

  window.openElementInEditor = openElementSource;

  window.addEventListener(
    "click",
    (event) => {
      if (!event.altKey) return;
      const element = findSourceElement(event.target);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      void openElementSource(element).then((result) => {
        if (!result.ok) console.warn("[openInEditor]", result.reason);
      });
    },
    { capture: true },
  );
}
