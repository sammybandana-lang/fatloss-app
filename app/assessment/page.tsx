import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AssessmentClient } from "./AssessmentClient";
import { PageShell } from "@/app/_components/design/PageShell";

export default async function AssessmentPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Real "must be signed in" check — runs on the server against the
  // verified session, never trusting the screen.
  if (!user) {
    redirect("/login");
  }

  return (
    <PageShell>
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[32px] font-normal text-primary sm:text-[44px]">
          Assessment
        </h1>
        <Link href="/" className="text-sm text-secondary hover:text-primary">
          Back to dashboard
        </Link>
      </div>

      <AssessmentClient />
    </PageShell>
  );
}
