import { Eyebrow } from "./Eyebrow";

type Grade = "A+" | "B+" | "C" | "D";

const GRADE_COLOR_CLASS: Record<Grade, string> = {
  "A+": "text-gold",
  "B+": "text-primary",
  C: "text-gold/60",
  D: "text-off-track",
};

/** The signature moment: a huge grade next to an italic one-line assessment. */
export function GradeDisplay({
  grade,
  assessment,
}: {
  grade: Grade;
  assessment: string;
}) {
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-10">
      <span
        className={`font-display text-[96px] font-light leading-[0.82] tracking-[-0.04em] sm:text-[148px] ${GRADE_COLOR_CLASS[grade]}`}
        style={{ fontVariationSettings: '"opsz" 144, "wght" 300' }}
      >
        {grade}
      </span>
      <div className="flex flex-col">
        <p
          className="font-display mb-3.5 max-w-[320px] text-lg leading-[1.5] text-primary italic"
          style={{ fontVariationSettings: '"opsz" 24' }}
        >
          {assessment}
        </p>
        <Eyebrow>Overall grade</Eyebrow>
      </div>
    </div>
  );
}
