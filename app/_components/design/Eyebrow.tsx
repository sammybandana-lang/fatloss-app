/** Tiny uppercase section label. The only place uppercase text is used in this app. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3.5 text-[11px] font-medium uppercase tracking-[0.14em] text-secondary">
      {children}
    </p>
  );
}
