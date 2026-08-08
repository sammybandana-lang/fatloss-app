import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGoals } from "./actions";
import { GoalsForm } from "./GoalsForm";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Goals</h1>
        <Link href="/" className="text-sm text-zinc-500 underline">
          Back to dashboard
        </Link>
      </div>

      <GoalsForm initialGoals={goals} />
    </main>
  );
}
