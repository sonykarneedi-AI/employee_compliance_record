"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { getSupabaseClient, SUPABASE_ENV_ERROR } from "@/lib/supabaseClient";

type Mode = "signIn" | "signUp";

export default function LoginPage() {
  const router = useRouter();
  const supabase = getSupabaseClient();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submitLabel = useMemo(() => {
    if (loading) return "Please wait…";
    return mode === "signIn" ? "Sign in" : "Create account";
  }, [loading, mode]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setLoading(true);
    try {
      if (!supabase) {
        throw new Error(SUPABASE_ENV_ERROR);
      }
      if (mode === "signIn") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push("/");
        router.refresh();
        return;
      }

      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      setMessage(
        "Account created. If email confirmation is enabled, check your inbox before signing in."
      );
      setMode("signIn");
      setPassword("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-6 py-10">
        <div className="rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/15 dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {mode === "signIn" ? "Welcome back" : "Create your account"}
              </h1>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Sign in with Supabase authentication.
              </p>
            </div>
            <Link
              href="/"
              className="text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
            >
              Home
            </Link>
          </div>

          {message ? (
            <div className="mt-6 rounded-xl border border-black/10 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-white/15 dark:bg-black/30 dark:text-zinc-200">
              {message}
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none ring-0 placeholder:text-zinc-400 focus:border-black/20 dark:border-white/15 dark:bg-zinc-950 dark:placeholder:text-zinc-500 dark:focus:border-white/30"
                placeholder="you@company.com"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-medium text-zinc-800 dark:text-zinc-200"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={
                  mode === "signIn" ? "current-password" : "new-password"
                }
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none ring-0 placeholder:text-zinc-400 focus:border-black/20 dark:border-white/15 dark:bg-zinc-950 dark:placeholder:text-zinc-500 dark:focus:border-white/30"
                placeholder="••••••••"
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Minimum 6 characters.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-black"
            >
              {submitLabel}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between gap-4 text-sm">
            <button
              type="button"
              onClick={() => {
                setMessage(null);
                setMode((m) => (m === "signIn" ? "signUp" : "signIn"));
              }}
              className="font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
            >
              {mode === "signIn"
                ? "Need an account? Sign up"
                : "Already have an account? Sign in"}
            </button>
            <a
              href="https://supabase.com/docs/guides/auth"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Supabase Auth docs
            </a>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Tip: set your Supabase Site URL to your dev URL (e.g.{" "}
          <span className="font-mono">http://localhost:3000</span>) when using
          email confirmations.
        </p>
      </div>
    </div>
  );
}

