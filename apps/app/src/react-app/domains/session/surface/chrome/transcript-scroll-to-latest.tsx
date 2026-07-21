/** @jsxImportSource react */
import { ChevronsDown } from "lucide-react";

import { Button } from "@/components/ui/button";

export function TranscriptScrollToLatest(props: {
  visible: boolean;
  label: string;
  onActivate: () => void;
}) {
  if (!props.visible) return null;

  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 justify-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="session-workbuddy-scroll-to-bottom pointer-events-auto"
        title={props.label}
        aria-label={props.label}
        onClick={props.onActivate}
      >
        {/* Double chevron matches the floating “jump to latest” chip (clearer in dark). */}
        <ChevronsDown className="size-4" strokeWidth={2.25} aria-hidden="true" />
      </Button>
    </div>
  );
}
