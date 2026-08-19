"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export default function AdminDataPage() {
  const { loading } = useAuth();
  const [tables, setTables] = useState<string[]>([]);
  const [table, setTable] = useState<string>("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [editJson, setEditJson] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const PAGE_SIZE = 100;

  const tokenRef = useCallback(async () => {
    const {
      data: { session },
    } = await getSupabaseBrowser().auth.getSession();
    return session?.access_token ?? null;
  }, []);

  useEffect(() => {
    if (loading) return;
    void (async () => {
      const t = await tokenRef();
      if (!t) return;
      try {
        const { tables: list } = await apiFetch<{ tables: string[] }>("/api/admin/tables", t);
        setTables(list);
        setTable((prev) => prev || list[0] || "");
      } catch (e) {
        setMsg((e as Error).message);
      }
    })();
  }, [loading, tokenRef]);

  const loadRows = useCallback(
    async (offset = 0) => {
      if (!table) return;
      const t = await tokenRef();
      if (!t) return;
      setBusy(true);
      setMsg(null);
      try {
        const data = await apiFetch<{
          rows: Record<string, unknown>[];
          total: number;
          offset: number;
          limit: number;
          has_more: boolean;
        }>(`/api/admin/tables/${table}/rows?limit=${PAGE_SIZE}&offset=${offset}`, t);
        setRows((prev) => (offset === 0 ? data.rows : [...prev, ...data.rows]));
        setTotal(data.total);
        setHasMore(data.has_more);
        setSelected(null);
        setEditJson("");
      } catch (e) {
        setMsg((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [table, tokenRef],
  );

  useEffect(() => {
    if (loading || !table) return;
    loadRows(0).catch((e) => setMsg((e as Error).message));
  }, [loading, table, loadRows]);

  const pkGuess = useMemo(() => {
    if (!selected) return null;
    const keys = Object.keys(selected);
    const prefer = [
      "user_id",
      "provider_id",
      "service_id",
      "request_id",
      "emergency_id",
      "payment_id",
      "prescription_id",
      "feedback_id",
      "record_id",
      "availability_id",
    ];
    for (const k of prefer) {
      if (keys.includes(k)) return k;
    }
    return keys[0] ?? null;
  }, [selected]);

  async function saveEdit() {
    if (!table || !selected || !pkGuess) return;
    const t = await tokenRef();
    if (!t) return;
    setBusy(true);
    setMsg(null);
    try {
      const body = JSON.parse(editJson) as Record<string, unknown>;
      await apiFetch(`/api/admin/tables/${table}/rows`, t, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setMsg("Row updated.");
      await loadRows(0);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-amber-400">Data tables</h1>
        <p className="mt-1 text-sm text-zinc-500">
          View rows and patch updates through the service-role API. Primary key must stay in the JSON
          body.
        </p>
      </div>

      {msg && (
        <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-amber-100/90" role="status">
          {msg}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">Table</span>
          <select
            className="rounded-lg border border-amber-900/40 bg-black/30 px-3 py-2 text-zinc-100"
            value={table}
            onChange={(e) => setTable(e.target.value)}
          >
            {tables.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => loadRows(0)}
          className="rounded-lg border border-amber-700/50 px-4 py-2 text-sm text-amber-200 hover:bg-amber-500/10"
        >
          Refresh
        </button>
        <span className="text-xs text-zinc-500">
          Showing {rows.length} of {total} rows
        </span>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="overflow-x-auto rounded-2xl border border-amber-900/30">
          <table className="w-full min-w-[320px] text-left text-xs">
            <thead className="border-b border-amber-900/40 bg-stone-950/80 text-zinc-500">
              <tr>
                <th className="px-2 py-2">Preview</th>
                <th className="px-2 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-900/20">
              {rows.map((r, i) => {
                const id = String(Object.values(r)[0] ?? i);
                return (
                  <tr key={id} className="bg-zinc-950/40">
                    <td className="max-w-[240px] truncate px-2 py-2 font-mono text-zinc-400">
                      {JSON.stringify(r).slice(0, 120)}…
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        className="text-amber-300 hover:underline"
                        onClick={() => {
                          setSelected(r);
                          setEditJson(JSON.stringify(r, null, 2));
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasMore && (
            <div className="border-t border-amber-900/20 p-2 text-center">
              <button
                type="button"
                disabled={busy}
                onClick={() => loadRows(rows.length)}
                className="text-xs text-amber-300 hover:underline disabled:opacity-50"
              >
                Load more
              </button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-amber-900/30 bg-stone-950/80 p-4">
          <h2 className="text-sm font-semibold text-zinc-300">Edit row (JSON)</h2>
          {selected && pkGuess && (
            <p className="mt-1 text-xs text-zinc-500">
              Primary key field for this table: <code className="text-amber-200">{pkGuess}</code>
            </p>
          )}
          <textarea
            className="mt-3 h-[min(480px,50vh)] w-full rounded-lg border border-amber-900/40 bg-black/40 p-3 font-mono text-xs text-zinc-200"
            value={editJson}
            onChange={(e) => setEditJson(e.target.value)}
            spellCheck={false}
          />
          <button
            type="button"
            disabled={busy || !selected}
            onClick={() => saveEdit()}
            className="mt-4 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-stone-950 disabled:opacity-50"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
