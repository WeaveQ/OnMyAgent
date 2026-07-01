/** @jsxImportSource react */
import type { ComponentProps } from "react";

export type TextInputProps = ComponentProps<"input"> & {
  label?: string;
  hint?: string;
  wrapperClassName?: string;
};

const textInputClass = {
  wrapper: "block",
  label: "mb-1 text-xs font-medium text-dls-secondary",
  input: "w-full rounded-lg border border-dls-border bg-dls-surface px-3 py-2 text-sm text-dls-text placeholder:text-dls-secondary focus:outline-none focus:ring-2 focus:ring-dls-accent/20",
  hint: "mt-1 text-xs text-dls-secondary",
};

export function TextInput({ label, hint, className, wrapperClassName, ref, ...rest }: TextInputProps) {
  return (
    <label className={wrapperClassName ?? textInputClass.wrapper}>
      {label ? (
        <div className={textInputClass.label}>
          {label}
        </div>
      ) : null}
      <input
        ref={ref}
        className={`${textInputClass.input} ${
          className ?? ""
        }`.trim()}
        {...rest}
      />
      {hint ? (
        <div className={textInputClass.hint}>{hint}</div>
      ) : null}
    </label>
  );
}
