/** @jsxImportSource react */

/** Three accent dots — inherits text color so dark mode stays readable. */
export function ExpertStatusDots(props: { className?: string }) {
  return (
    <span
      className={
        props.className ?? "inline-flex items-center gap-[3px]"
      }
      aria-hidden
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="expert-status-dot size-[3.5px] rounded-full"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </span>
  );
}
