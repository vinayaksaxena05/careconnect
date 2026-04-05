"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

type Service = {
  service_id: string;
  service_name: string;
  base_price: number;
  duration_minutes: number;
};

export default function AdminCatalogPage() {
  const { loading } = useAuth();
  const [rows, setRows] = useState<Service[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    service_name: "",
    base_price: "",
    duration_minutes: "30",
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [editPatch, setEditPatch] = useState<Partial<Service>>({});

  const tokenRef = useCallback(async () => {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession();
    return session?.access_token ?? null;
  }, []);

  const reload = useCallback(async () => {
    const t = await tokenRef();
    if (!t) return;
    setRows(await apiFetch<Service[]>("/api/admin/service-types", t));
  }, [tokenRef]);

  useEffect(() => {
    if (loading) return;
    reload().catch((e) => setMsg((e as Error).message));
  }, [loading, reload]);

  async function addService(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const t = await tokenRef();
      if (!t) return;
      await apiFetch("/api/admin/service-types", t, {
        method: "POST",
        body: JSON.stringify({
          service_name: form.service_name.trim(),
          base_price: Number(form.base_price),
          duration_minutes: Number(form.duration_minutes) || 30,
        }),
      });
      setForm({ service_name: "", base_price: "", duration_minutes: "30" });
      setMsg("Service type added.");
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setMsg(null);
    try {
      const t = await tokenRef();
      if (!t) return;
      const row = rows.find((r) => r.service_id === id);
      if (!row) return;
      await apiFetch(`/api/admin/service-types/${id}`, t, {
        method: "PATCH",
        body: JSON.stringify({
          service_name: editPatch.service_name ?? row.service_name,
          base_price: editPatch.base_price ?? row.base_price,
          duration_minutes: editPatch.duration_minutes ?? row.duration_minutes,
        }),
      });
      setEditing(null);
      setEditPatch({});
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-amber-400">Service catalog</h1>
        <p className="mt-1 text-zinc-500">
          Services and prices shown when patients book a visit.
        </p>
      </div>

      {msg && (
        <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-amber-100/90">{msg}</p>
      )}

      <form
        onSubmit={addService}
        className="rounded-2xl border border-amber-900/30 bg-stone-950/80 p-6"
      >
        <h2 className="text-lg font-semibold text-zinc-200">Add service type</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-sm text-zinc-500">Name</span>
            <input
              required
              className="rounded-lg border border-amber-900/40 bg-black/30 px-3 py-2 text-zinc-100"
              value={form.service_name}
              onChange={(e) => setForm((f) => ({ ...f, service_name: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-500">Price (₹)</span>
            <input
              required
              type="number"
              min={0}
              step={0.01}
              className="rounded-lg border border-amber-900/40 bg-black/30 px-3 py-2 text-zinc-100"
              value={form.base_price}
              onChange={(e) => setForm((f) => ({ ...f, base_price: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-500">Duration (min)</span>
            <input
              type="number"
              min={5}
              className="rounded-lg border border-amber-900/40 bg-black/30 px-3 py-2 text-zinc-100"
              value={form.duration_minutes}
              onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-6 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-stone-950 disabled:opacity-50"
        >
          Add to catalog
        </button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-amber-900/30">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="border-b border-amber-900/40 bg-stone-950/80 text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Service</th>
              <th className="px-4 py-3 font-medium">Price</th>
              <th className="px-4 py-3 font-medium">Minutes</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-900/20">
            {rows.map((s) => (
              <tr key={s.service_id} className="bg-zinc-950/40">
                {editing === s.service_id ? (
                  <>
                    <td className="px-4 py-2">
                      <input
                        className="w-full rounded border border-amber-900/40 bg-black/40 px-2 py-1 text-zinc-100"
                        defaultValue={s.service_name}
                        onChange={(e) =>
                          setEditPatch((p) => ({ ...p, service_name: e.target.value }))
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        className="w-24 rounded border border-amber-900/40 bg-black/40 px-2 py-1 text-zinc-100"
                        defaultValue={s.base_price}
                        onChange={(e) =>
                          setEditPatch((p) => ({
                            ...p,
                            base_price: Number(e.target.value),
                          }))
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        className="w-20 rounded border border-amber-900/40 bg-black/40 px-2 py-1 text-zinc-100"
                        defaultValue={s.duration_minutes}
                        onChange={(e) =>
                          setEditPatch((p) => ({
                            ...p,
                            duration_minutes: Number(e.target.value),
                          }))
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => saveEdit(s.service_id)}
                        className="text-amber-400 hover:underline"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="ml-3 text-zinc-500 hover:underline"
                        onClick={() => {
                          setEditing(null);
                          setEditPatch({});
                        }}
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3 text-zinc-200">{s.service_name}</td>
                    <td className="px-4 py-3 text-zinc-300">₹{Number(s.base_price).toFixed(0)}</td>
                    <td className="px-4 py-3 text-zinc-400">{s.duration_minutes}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(s.service_id);
                          setEditPatch({
                            service_name: s.service_name,
                            base_price: s.base_price,
                            duration_minutes: s.duration_minutes,
                          });
                        }}
                        className="text-sm text-amber-400/90 hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
