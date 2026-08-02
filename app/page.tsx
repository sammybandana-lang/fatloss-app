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
    .select(
      "id, weight_lbs, body_fat_pct, waist_in, hips_in, neck_in, created_at",
    )
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

      <form
        action={addMeasurement}
        className="flex flex-col gap-3 rounded border border-zinc-200 p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
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

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Body fat %
            <input
              name="body_fat_pct"
              type="number"
              step="0.1"
              min="0"
              className="rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Waist (in)
            <input
              name="waist_in"
              type="number"
              step="0.1"
              min="0"
              className="rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Hips (in)
            <input
              name="hips_in"
              type="number"
              step="0.1"
              min="0"
              className="rounded border border-zinc-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Neck (in)
            <input
              name="neck_in"
              type="number"
              step="0.1"
              min="0"
              className="rounded border border-zinc-300 px-3 py-2"
            />
          </label>
        </div>

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
              className="flex flex-col gap-1 rounded border border-zinc-200 px-3 py-2 text-sm"
            >
              <div className="flex justify-between">
                <span className="font-medium">
                  {measurement.weight_lbs} lbs
                </span>
                <span className="text-zinc-500">
                  {new Date(measurement.created_at).toLocaleDateString()}
                </span>
              </div>
              {(measurement.body_fat_pct !== null ||
                measurement.waist_in !== null ||
                measurement.hips_in !== null ||
                measurement.neck_in !== null) && (
                <div className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
                  {measurement.body_fat_pct !== null && (
                    <span>Body fat: {measurement.body_fat_pct}%</span>
                  )}
                  {measurement.waist_in !== null && (
                    <span>Waist: {measurement.waist_in} in</span>
                  )}
                  {measurement.hips_in !== null && (
                    <span>Hips: {measurement.hips_in} in</span>
                  )}
                  {measurement.neck_in !== null && (
                    <span>Neck: {measurement.neck_in} in</span>
                  )}
                </div>
              )}
            </li>
          ))
        ) : (
          <p className="text-sm text-zinc-500">No measurements yet.</p>
        )}
      </ul>
    </main>
  );
}
