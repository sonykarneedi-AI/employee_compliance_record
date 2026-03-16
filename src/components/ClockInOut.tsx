"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type TimeEntryRow = {
  id: string;
  user_id: string;
  clock_in: string;
  clock_out: string | null;
};

type Status =
  | { kind: "signed_out" }
  | { kind: "clocked_out" }
  | { kind: "clocked_in"; entry: TimeEntryRow };

function formatTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function ClockInOut() {
  const [status, setStatus] = useState<Status>({ kind: "signed_out" });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primaryLabel = useMemo(() => {
    if (actionLoading) return "Please wait…";
    if (status.kind === "signed_out") return "Sign in to clock in";
    if (status.kind === "clocked_in") return "Clock out";
    return "Clock in";
  }, [actionLoading, status.kind]);

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        setStatus({ kind: "signed_out" });
        return;
      }

      // Assumed schema:
      // time_entries(id uuid, user_id uuid, clock_in timestamptz, clock_out timestamptz null)
      // "Open" entry = latest row where clock_out IS NULL
      const { data, error: qErr } = await supabase
        .from("time_entries")
        .select("id,user_id,clock_in,clock_out")
        .eq("user_id", user.id)
        .is("clock_out", null)
        .order("clock_in", { ascending: false })
        .limit(1);

      if (qErr) throw qErr;

      const open = (data?.[0] ?? null) as TimeEntryRow | null;
      if (open) setStatus({ kind: "clocked_in", entry: open });
      else setStatus({ kind: "clocked_out" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load status.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function onPrimaryAction() {
    setError(null);
    setActionLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        setStatus({ kind: "signed_out" });
        return;
      }

      if (status.kind === "clocked_in") {
        const { error: uErr } = await supabase
          .from("time_entries")
          .update({ clock_out: new Date().toISOString() })
          .eq("id", status.entry.id)
          .eq("user_id", user.id)
          .is("clock_out", null);
        if (uErr) throw uErr;
      } else {
        const { error: iErr } = await supabase.from("time_entries").insert({
          user_id: user.id,
          clock_in: new Date().toISOString(),
          clock_out: null,
        });
        if (iErr) throw iErr;
      }

      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action failed.";
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });
    return () => {
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="w-full max-w-xl rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/15 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Time clock</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Clock in/out is saved to Supabase.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || actionLoading}
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-60 dark:text-zinc-300 dark:hover:text-white"
        >
          Refresh
        </button>
      </div>

      <div className="mt-5 rounded-xl border border-black/10 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-white/15 dark:bg-black/30 dark:text-zinc-200">
        {loading ? (
          <span>Loading…</span>
        ) : status.kind === "signed_out" ? (
          <span>
            You’re signed out. Use the <span className="font-mono">/login</span>{" "}
            page first.
          </span>
        ) : status.kind === "clocked_in" ? (
          <span>
            Status: <span className="font-medium">Clocked in</span> since{" "}
            <span className="font-mono">{formatTime(status.entry.clock_in)}</span>
          </span>
        ) : (
          <span>
            Status: <span className="font-medium">Clocked out</span>
          </span>
        )}
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onPrimaryAction}
          disabled={loading || actionLoading || status.kind === "signed_out"}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-black"
        >
          {primaryLabel}
        </button>
        {status.kind !== "signed_out" ? (
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            disabled={loading || actionLoading}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-black/10 bg-white text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60 dark:border-white/15 dark:bg-zinc-950 dark:text-white dark:hover:bg-white/5"
          >
            Sign out
          </button>
        ) : null}
      </div>

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        Table assumed: <span className="font-mono">time_entries</span> with{" "}
        <span className="font-mono">user_id</span>,{" "}
        <span className="font-mono">clock_in</span>,{" "}
        <span className="font-mono">clock_out</span>.
      </p>
    </section>
  );
}

