/** Label + big display value + optional unit, e.g. "Starting" / "210" / "lbs". */
export function StatBlock({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="mb-2 text-xs text-secondary">{label}</span>
      <span className="flex items-baseline">
        <span
          className="font-display text-[32px] font-normal leading-none text-primary sm:text-[40px]"
          style={{ fontVariationSettings: '"opsz" 72' }}
        >
          {value}
        </span>
        {unit && (
          <span className="font-mono ml-1.5 text-[13px] text-secondary">{unit}</span>
        )}
      </span>
    </div>
  );
}
