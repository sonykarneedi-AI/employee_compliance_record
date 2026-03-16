"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type StoredFile = {
  name: string;
  updated_at?: string;
  created_at?: string;
  metadata?: { size?: number };
};

function formatBytes(bytes?: number) {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function safeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

export function DocumentUpload({
  bucket = "documents",
}: {
  bucket?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [selected, setSelected] = useState<File | null>(null);

  const canUpload = useMemo(
    () => !loading && !actionLoading && !!selected,
    [actionLoading, loading, selected]
  );

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        setFiles([]);
        return;
      }

      const prefix = `${user.id}/`;
      const { data, error: lErr } = await supabase.storage
        .from(bucket)
        .list(prefix, { limit: 100, sortBy: { column: "updated_at", order: "desc" } });
      if (lErr) throw lErr;

      setFiles((data ?? []) as StoredFile[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load documents.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function onUpload() {
    setError(null);
    setActionLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        setError("You’re signed out. Please sign in first.");
        return;
      }
      if (!selected) return;

      const cleaned = safeFileName(selected.name);
      const path = `${user.id}/${Date.now()}_${cleaned}`;

      const { error: uErr } = await supabase.storage
        .from(bucket)
        .upload(path, selected, {
          cacheControl: "3600",
          upsert: false,
          contentType: selected.type || undefined,
        });
      if (uErr) throw uErr;

      setSelected(null);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  }

  async function downloadUrl(fileName: string) {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return null;

    const path = `${user.id}/${fileName}`;
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
    return data?.signedUrl ?? null;
  }

  useEffect(() => {
    refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => refresh());
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="w-full max-w-xl rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/15 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Documents</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Upload compliance documents to Supabase Storage.
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

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="file"
          onChange={(e) => setSelected(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:opacity-90 dark:file:bg-white dark:file:text-black"
        />
        <button
          type="button"
          onClick={onUpload}
          disabled={!canUpload}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-black sm:w-40"
        >
          {actionLoading ? "Uploading…" : "Upload"}
        </button>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            Your files
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Bucket: <span className="font-mono">{bucket}</span>
          </p>
        </div>

        <div className="mt-3 rounded-xl border border-black/10 bg-zinc-50 p-3 dark:border-white/15 dark:bg-black/30">
          {loading ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Loading…</p>
          ) : files.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              No documents uploaded yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {files.map((f) => (
                <li
                  key={f.name}
                  className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm dark:bg-zinc-950"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{f.name}</p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {formatBytes(f.metadata?.size)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setError(null);
                      try {
                        const url = await downloadUrl(f.name);
                        if (!url) throw new Error("Could not create download link.");
                        window.open(url, "_blank", "noopener,noreferrer");
                      } catch (e) {
                        const msg =
                          e instanceof Error ? e.message : "Download failed.";
                        setError(msg);
                      }
                    }}
                    className="shrink-0 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
                  >
                    Download
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        Files are stored under <span className="font-mono">userId/</span> paths.
        Make sure your Storage policies allow authenticated users to read/write
        their own folder.
      </p>
    </section>
  );
}

