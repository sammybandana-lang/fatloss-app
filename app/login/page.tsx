"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { login, signup } from "./actions";
import { Card } from "@/app/_components/design/Card";

const inputClass =
  "rounded-inner border-[0.5px] border-hairline bg-transparent px-4 py-3 text-sm text-primary focus:border-gold focus:outline-none";

function LoginForm() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const message = searchParams.get("message");

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-6 sm:px-8">
      <div className="w-full max-w-[400px]">
        <Card>
          <h1 className="font-display text-[32px] font-normal text-primary">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-secondary">Welcome back</p>

          <form className="mt-8 flex flex-col gap-6">
            {error && <p className="text-sm text-off-track">{error}</p>}
            {message && <p className="text-sm text-on-track">{message}</p>}

            <label className="flex flex-col gap-1.5 text-xs text-secondary">
              Email
              <input name="email" type="email" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-secondary">
              Password
              <input
                name="password"
                type="password"
                required
                minLength={6}
                className={inputClass}
              />
            </label>

            <button
              formAction={login}
              className="w-full rounded-inner bg-primary px-4 py-3 text-sm font-medium text-bg hover:opacity-85"
            >
              Log in
            </button>

            <button
              formAction={signup}
              className="text-center text-[13px] text-secondary hover:text-primary"
            >
              Sign up
            </button>
          </form>
        </Card>
      </div>
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
