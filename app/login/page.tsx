"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { login, signup } from "./actions";

function LoginForm() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const message = searchParams.get("message");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">Fat Loss Tracker</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-700">{message}</p>}

      <form className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            required
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={6}
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </label>
        <div className="flex gap-3 pt-2">
          <button
            formAction={signup}
            className="flex-1 rounded border border-black px-4 py-2 text-sm font-medium"
          >
            Sign up
          </button>
          <button
            formAction={login}
            className="flex-1 rounded bg-black px-4 py-2 text-sm font-medium text-white"
          >
            Log in
          </button>
        </div>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
