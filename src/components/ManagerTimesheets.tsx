"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient, SUPABASE_ENV_ERROR } from "@/lib/supabaseClient";
import { formatMinutes, minutesBetween, startOfWeek } from "@/lib/time";

// Update these if your schema differs.
const TIME_ENTRIES_TABLE = "time_entries";
const COL_CLOCK_IN = "clock_in";
const COL_CLOCK_OUT = "clock_out";
const COL_USER_ID = "user_id";

// Optional approval columns on time_entries (recommended).
// If you don't have these yet, the UI will still load, but approve/reject will error until added.
const COL_APPROVAL_STATUS = "approval_status"; // 'pending' | 'approved' | 'rejected'
const COL_APPROVED_AT = "approved_at"; // timestamptz
const COL_APPROVED_BY = "approved_by"; // uuid
const COL_MANAGER_NOTE = "manager_note"; // text

type TimeEntry = {
  id: string;
  user_id: string;
  clock_in: string;
  clock_out: string | null;
  approval_status?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  manager_note?: string | null;
};

type Timesheet = {
  key: string;
  userId: string;
  weekStartIso: string;
  totalMinutes: number;
  entries: TimeEntry[];
  status: "pending" | "approved" | "rejected";
};

function isoDate(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function displayDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function statusFromEntries(entries: TimeEntry[]): Timesheet["status"] {
  // Any rejected wins, else any pending wins, else approved.
  const statuses = entries.map((e) => (e.approval_status ?? "pending").toLowerCase());
  if (statuses.includes("rejected")) return "rejected";
  if (statuses.includes("pending")) return "pending";
  return "approved";
}

export function ManagerTimesheets() {
  const supabase = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [managerNote, setManagerNote] = useState<Record<string, string>>({});

  const pendingCount = useMemo(
    () => timesheets.filter((t) => t.status === "pending").length,
    [timesheets]
  );

  const refresh = useCallback(async () => {
    const sb = supabase;
    setError(null);
    setLoading(true);
    try {
      if (!sb) {
        setTimesheets([]);
        setError(SUPABASE_ENV_ERROR);
        return;
      }

      const { data: auth } = await sb.auth.getUser();
      if (!auth.user) {
        setTimesheets([]);
        setError("You must be signed in to view the manager dashboard.");
        return;
      }

      const since = new Date();
      since.setDate(since.getDate() - 28);

      const { data, error: qErr } = await sb
        .from(TIME_ENTRIES_TABLE)
        .select(
          [
            "id",
            COL_USER_ID,
            COL_CLOCK_IN,
            COL_CLOCK_OUT,
            COL_APPROVAL_STATUS,
            COL_APPROVED_AT,
            COL_APPROVED_BY,
            COL_MANAGER_NOTE,
          ].join(",")
        )
        // only completed shifts
        .not(COL_CLOCK_OUT, "is", null)
        .gte(COL_CLOCK_IN, since.toISOString())
        .order(COL_CLOCK_IN, { ascending: false })
        .limit(500);

      if (qErr) throw qErr;

      const rows = (data ?? []) as unknown as TimeEntry[];

      // Group into (employee, weekStart) "timesheets"
      const map = new Map<string, Timesheet>();
      for (const e of rows) {
        if (!e.clock_in || !e.clock_out) continue;
        const weekStart = startOfWeek(new Date(e.clock_in));
        const key = `${e.user_id}:${isoDate(weekStart)}`;

        const minutes = minutesBetween(e.clock_in, e.clock_out);
        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            key,
            userId: e.user_id,
            weekStartIso: isoDate(weekStart),
            totalMinutes: minutes,
            entries: [e],
            status: statusFromEntries([e]),
          });
        } else {
          existing.totalMinutes += minutes;
          existing.entries.push(e);
          existing.status = statusFromEntries(existing.entries);
        }
      }

      const list = Array.from(map.values()).sort((a, b) =>
        b.weekStartIso.localeCompare(a.weekStartIso)
      );
      setTimesheets(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load timesheets.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  async function setStatus(timesheet: Timesheet, status: "approved" | "rejected") {
    const sb = supabase;
    setError(null);
    setActionLoadingKey(timesheet.key);
    try {
      if (!sb) {
        throw new Error(SUPABASE_ENV_ERROR);
      }

      const { data: auth } = await sb.auth.getUser();
      const manager = auth.user;
      if (!manager) throw new Error("You must be signed in.");

      const note = (managerNote[timesheet.key] ?? "").trim();

      // Update all entries in this timesheet group.
      const ids = timesheet.entries.map((e) => e.id);
      const { error: uErr } = await sb
        .from(TIME_ENTRIES_TABLE)
        .update({
          [COL_APPROVAL_STATUS]: status,
          [COL_APPROVED_AT]: new Date().toISOString(),
          [COL_APPROVED_BY]: manager.id,
          [COL_MANAGER_NOTE]: note || null,
        })
        .in("id", ids);

      if (uErr) throw uErr;
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed.";
      setError(msg);
    } finally {
      setActionLoadingKey(null);
    }
  }

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setError(SUPABASE_ENV_ERROR);
      return;
    }

    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => refresh());
    return () => sub.subscription.unsubscribe();
  }, [refresh, supabase]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Manager dashboard
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Approve or reject employee timesheets (grouped by week).
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-950 dark:text-white dark:hover:bg-white/5"
            >
              Home
            </Link>
            <button
              type="button"
              onClick={refresh}
              disabled={loading || !!actionLoadingKey}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-black"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-zinc-950">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Timesheets</p>
            <p className="mt-2 text-2xl font-semibold">{timesheets.length}</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-zinc-950">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Pending</p>
            <p className="mt-2 text-2xl font-semibold">{pendingCount}</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/15 dark:bg-zinc-950">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Window</p>
            <p className="mt-2 text-2xl font-semibold">Last 28 days</p>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200">
            {error}
            <div className="mt-2 text-xs opacity-90">
              Expected columns on <span className="font-mono">{TIME_ENTRIES_TABLE}</span>:{" "}
              <span className="font-mono">
                id, {COL_USER_ID}, {COL_CLOCK_IN}, {COL_CLOCK_OUT}
              </span>{" "}
              and for approvals:{" "}
              <span className="font-mono">
                {COL_APPROVAL_STATUS}, {COL_APPROVED_AT}, {COL_APPROVED_BY}, {COL_MANAGER_NOTE}
              </span>
              .
            </div>
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          {loading ? (
            <div className="rounded-2xl border border-black/10 bg-white p-6 text-sm text-zinc-600 dark:border-white/15 dark:bg-zinc-950 dark:text-zinc-300">
              Loading…
            </div>
          ) : timesheets.length === 0 ? (
            <div className="rounded-2xl border border-black/10 bg-white p-6 text-sm text-zinc-600 dark:border-white/15 dark:bg-zinc-950 dark:text-zinc-300">
              No completed time entries found in the last 28 days.
            </div>
          ) : (
            timesheets.map((t) => {
              const busy = actionLoadingKey === t.key;
              return (
                <div
                  key={t.key}
                  className="rounded-2xl border border-black/10 bg-white p-6 dark:border-white/15 dark:bg-zinc-950"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        Employee
                      </p>
                      <p className="mt-1 truncate font-mono text-sm">
                        {t.userId}
                      </p>
                      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                        Week of <span className="font-medium text-zinc-900 dark:text-white">{displayDate(t.weekStartIso)}</span>
                      </p>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                        Total:{" "}
                        <span className="font-medium text-zinc-900 dark:text-white">
                          {formatMinutes(t.totalMinutes)}
                        </span>
                        {" · "}
                        Entries:{" "}
                        <span className="font-medium text-zinc-900 dark:text-white">
                          {t.entries.length}
                        </span>
                      </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:w-[360px]">
                      <div className="flex items-center justify-between">
                        <span
                          className={[
                            "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
                            t.status === "approved"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200"
                              : t.status === "rejected"
                                ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200",
                          ].join(" ")}
                        >
                          {t.status.toUpperCase()}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setManagerNote((m) => ({
                              ...m,
                              [t.key]: m[t.key] ?? "",
                            }))
                          }
                          className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
                        >
                          Note
                        </button>
                      </div>

                      <textarea
                        value={managerNote[t.key] ?? ""}
                        onChange={(e) =>
                          setManagerNote((m) => ({ ...m, [t.key]: e.target.value }))
                        }
                        placeholder="Optional manager note (saved on approve/reject)"
                        rows={2}
                        className="w-full resize-none rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/20 dark:border-white/15 dark:bg-zinc-950 dark:focus:border-white/30"
                      />

                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setStatus(t, "approved")}
                          disabled={busy || loading}
                          className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                        >
                          {busy ? "Saving…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatus(t, "rejected")}
                          disabled={busy || loading}
                          className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-red-600 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                        >
                          {busy ? "Saving…" : "Reject"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white">
                      View entries
                    </summary>
                    <div className="mt-3 overflow-x-auto rounded-xl border border-black/10 dark:border-white/15">
                      <table className="min-w-full text-left text-sm">
                        <thead className="bg-zinc-50 text-xs text-zinc-600 dark:bg-black/30 dark:text-zinc-300">
                          <tr>
                            <th className="px-4 py-3">Clock in</th>
                            <th className="px-4 py-3">Clock out</th>
                            <th className="px-4 py-3">Duration</th>
                            <th className="px-4 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {t.entries
                            .slice()
                            .sort((a, b) => a.clock_in.localeCompare(b.clock_in))
                            .map((e) => (
                              <tr
                                key={e.id}
                                className="border-t border-black/5 bg-white dark:border-white/10 dark:bg-zinc-950"
                              >
                                <td className="px-4 py-3 font-mono text-xs">
                                  {new Date(e.clock_in).toLocaleString()}
                                </td>
                                <td className="px-4 py-3 font-mono text-xs">
                                  {e.clock_out
                                    ? new Date(e.clock_out).toLocaleString()
                                    : "—"}
                                </td>
                                <td className="px-4 py-3">
                                  {e.clock_out
                                    ? formatMinutes(minutesBetween(e.clock_in, e.clock_out))
                                    : "—"}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-xs text-zinc-600 dark:text-zinc-300">
                                    {(e.approval_status ?? "pending").toUpperCase()}
                                  </span>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-10 text-xs text-zinc-500 dark:text-zinc-400">
          If you want manager-only access, add RLS that only allows users with a
          manager role to <span className="font-mono">SELECT/UPDATE</span> time
          entries.
        </div>
      </div>
    </div>
  );
}

