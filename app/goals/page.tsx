import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGoals } from "./actions";
import { GoalsForm } from "./GoalsForm";
import { PageShell } from "@/app/_components/design/PageShell";

export default async function GoalsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Real "must be signed in" check — runs on the server against the
  // verified session, never trusting the screen.
  if (!user) {
    redirect("/login");
  }

  const goals = await getGoals();

  return (
    <PageShell>
      <div className="flex flex-col gap-10">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-normal text-primary sm:text-[32px]">
            Goals
          </h1>
          <Link href="/" className="text-sm text-secondary hover:text-primary">
            Back to dashboard
          </Link>
        </div>

        <GoalsForm initialGoals={goals} />
      </div>
    </PageShell>
  );
}
