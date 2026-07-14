/** @jsxImportSource react */
import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type LabeledInputProps = ComponentProps<"input"> & {
  label?: string;
  hint?: string;
  wrapperClassName?: string;
};

/** Canonical labeled single-line field — prefer over deprecated TextInput. */
export function LabeledInput({
  label,
  hint,
  className,
  wrapperClassName,
  ref,
  ...rest
}: LabeledInputProps) {
  return (
    <label className={wrapperClassName ?? "block"}>
      {label ? (
        <div className="mb-1 text-xs font-medium text-dls-secondary">{label}</div>
      ) : null}
      <Input ref={ref} variant="dls" className={cn(className)} {...rest} />
      {hint ? <div className="mt-1 text-xs text-dls-secondary">{hint}</div> : null}
    </label>
  );
}
