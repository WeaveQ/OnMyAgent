/** @jsxImportSource react */
import { ChevronDown } from "lucide-react";

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
        <ChevronDown className="size-4" />
      </Button>
    </div>
  );
}
