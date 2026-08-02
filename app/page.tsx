import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addMeasurement } from "./actions";
import { logout } from "./login/actions";

export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // This is the real "must be signed in" check — it runs on the server and
  // trusts only the verified session, never the screen.
  if (!user) {
    redirect("/login");
  }

  const { data: measurements, error } = await supabase
    .from("measurements")
    .select("id, weight_lbs, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your weight log V2</h1>
        <form action={logout}>
          <button type="submit" className="text-sm text-zinc-500 underline">
            Log out
          </button>
        </form>
      </div>

      <form action={addMeasurement} className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Weight (lbs)
          <input
            name="weight_lbs"
            type="number"
            step="0.1"
            min="0"
            required
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white"
        >
          Add
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {measurements && measurements.length > 0 ? (
          measurements.map((measurement) => (
            <li
              key={measurement.id}
              className="flex justify-between rounded border border-zinc-200 px-3 py-2 text-sm"
            >
              <span>{measurement.weight_lbs} lbs</span>
              <span className="text-zinc-500">
                {new Date(measurement.created_at).toLocaleDateString()}
              </span>
            </li>
          ))
        ) : (
          <p className="text-sm text-zinc-500">No measurements yet.</p>
        )}
      </ul>
    </main>
  );
}
