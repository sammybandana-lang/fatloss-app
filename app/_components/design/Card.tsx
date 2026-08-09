/** Surface container used for forms and grouped data throughout the app. */
export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card bg-surface px-6 py-8 sm:px-8 sm:py-10">
      {children}
    </div>
  );
}
