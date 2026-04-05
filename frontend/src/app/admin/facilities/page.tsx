"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

type Provider = {
  provider_id: string;
  name: string;
  specialization: string;
  license_number: string;
  verified: boolean;
};

export default function AdminFacilitiesPage() {
  const { loading } = useAuth();
  const [rows, setRows] = useState<Provider[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    specialization: "",
    license_number: "",
    verified: true,
  });

  const tokenRef = useCallback(async () => {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession();
    return session?.access_token ?? null;
  }, []);

  const reload = useCallback(async () => {
    const t = await tokenRef();
    if (!t) return;
    setRows(await apiFetch<Provider[]>("/api/admin/providers", t));
  }, [tokenRef]);

  useEffect(() => {
    if (loading) return;
    reload().catch((e) => setMsg((e as Error).message));
  }, [loading, reload]);

  async function addFacility(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const t = await tokenRef();
      if (!t) return;
      await apiFetch("/api/admin/providers", t, {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          specialization: form.specialization.trim(),
          license_number: form.license_number.trim(),
          verified: form.verified,
        }),
      });
      setForm({ name: "", specialization: "", license_number: "", verified: true });
      setMsg("Facility added.");
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleVerified(p: Provider) {
    setBusy(true);
    setMsg(null);
    try {
      const t = await tokenRef();
      if (!t) return;
      await apiFetch(`/api/admin/providers/${p.provider_id}`, t, {
        method: "PATCH",
        body: JSON.stringify({ verified: !p.verified }),
      });
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
        <h1 className="text-2xl font-bold text-amber-400">Facilities</h1>
        <p className="mt-1 text-zinc-500">
          Healthcare providers (ambulance units, doctors, paramedic teams) shown in the patient app.
        </p>
      </div>

      {msg && (
        <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-amber-100/90">{msg}</p>
      )}

      <form
        onSubmit={addFacility}
        className="rounded-2xl border border-amber-900/30 bg-stone-950/80 p-6"
      >
        <h2 className="text-lg font-semibold text-zinc-200">Add facility</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-sm text-zinc-500">Display name</span>
            <input
              required
              className="rounded-lg border border-amber-900/40 bg-black/30 px-3 py-2 text-zinc-100"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. North Chennai Rapid Response"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-500">Specialization</span>
            <input
              required
              className="rounded-lg border border-amber-900/40 bg-black/30 px-3 py-2 text-zinc-100"
              value={form.specialization}
              onChange={(e) => setForm((f) => ({ ...f, specialization: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-500">License number</span>
            <input
              required
              className="rounded-lg border border-amber-900/40 bg-black/30 px-3 py-2 text-zinc-100"
              value={form.license_number}
              onChange={(e) => setForm((f) => ({ ...f, license_number: e.target.value }))}
            />
          </label>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.verified}
              onChange={(e) => setForm((f) => ({ ...f, verified: e.target.checked }))}
            />
            <span className="text-sm text-zinc-400">Verified (visible for booking)</span>
          </label>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-6 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-stone-950 disabled:opacity-50"
        >
          Save facility
        </button>
      </form>

      <ul className="space-y-3">
        {rows.map((p) => (
          <li
            key={p.provider_id}
            className="flex flex-col justify-between gap-3 rounded-xl border border-amber-900/25 bg-stone-950/60 p-4 sm:flex-row sm:items-center"
          >
            <div>
              <p className="font-semibold text-zinc-200">{p.name}</p>
              <p className="text-sm text-zinc-500">
                {p.specialization} · {p.license_number}
              </p>
              <p className="mt-1 text-xs text-zinc-600">
                {p.verified ? (
                  <span className="text-emerald-400/90">Verified</span>
                ) : (
                  <span className="text-zinc-500">Not verified</span>
                )}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => toggleVerified(p)}
              className="rounded-lg border border-amber-800/50 px-4 py-2 text-sm text-amber-200 hover:bg-amber-500/10"
            >
              {p.verified ? "Mark unverified" : "Mark verified"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
