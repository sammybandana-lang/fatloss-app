import { Eyebrow } from "./Eyebrow";

/**
 * A labeled section with a bottom hairline divider, meant to be stacked
 * directly as siblings (no wrapping gap container needed) — the last one
 * in its parent automatically drops its divider and spacing via `last:`.
 */
export function DataRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-9 border-b-[0.5px] border-hairline pb-9 last:mb-0 last:border-0 last:pb-0 sm:mb-10 sm:pb-10">
      <Eyebrow>{label}</Eyebrow>
      {children}
    </div>
  );
}
