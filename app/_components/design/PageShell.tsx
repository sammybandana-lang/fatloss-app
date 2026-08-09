/**
 * Outer page container: dark background, responsive padding, and content
 * capped at 680px and centered. Every page (`/`, `/goals`, `/assessment`)
 * wraps its content in this. `/login` doesn't use it — it centers a
 * single narrow card vertically instead of a top-anchored content column.
 */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-bg px-4 py-6 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-[680px]">{children}</div>
    </main>
  );
}
