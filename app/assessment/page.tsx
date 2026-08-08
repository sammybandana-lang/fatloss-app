import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AssessmentClient } from "./AssessmentClient";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Assessment</h1>
        <Link href="/" className="text-sm text-zinc-500 underline">
          Back to dashboard
        </Link>
      </div>

      <AssessmentClient />
    </main>
  );
}
