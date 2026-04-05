"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

type Row = {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  created_at?: string;
};

export default function AdminUsersPage() {
  const { loading } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    role: "user" as "user" | "admin" | "provider",
  });

  const tokenRef = useCallback(async () => {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession();
    return session?.access_token ?? null;
  }, []);

  const reload = useCallback(async () => {
    const t = await tokenRef();
    if (!t) return;
    setRows(await apiFetch<Row[]>("/api/admin/users", t));
  }, [tokenRef]);

  useEffect(() => {
    if (loading) return;
    reload().catch((e) => setMsg((e as Error).message));
  }, [loading, reload]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const t = await tokenRef();
      if (!t) return;
      await apiFetch("/api/admin/users", t, {
        method: "POST",
        body: JSON.stringify({
          email: form.email.trim(),
          password: form.password,
          full_name: form.full_name.trim() || undefined,
          role: form.role,
        }),
      });
      setForm({ email: "", password: "", full_name: "", role: "user" });
      setMsg("User created.");
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setRole(userId: string, role: "admin" | "user" | "provider") {
    setBusy(true);
    setMsg(null);
    try {
      const t = await tokenRef();
      if (!t) return;
      await apiFetch(`/api/admin/users/${userId}/role`, t, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      setMsg(
        role === "admin"
          ? "Granted admin."
          : role === "provider"
            ? "Role set to provider."
            : "Role set to user.",
      );
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
        <h1 className="text-2xl font-bold text-amber-400">Users & roles</h1>
        <p className="mt-1 text-zinc-500">
          Create accounts and assign <strong className="text-zinc-300">admin</strong>,{" "}
          <strong className="text-zinc-300">provider</strong>, or{" "}
          <strong className="text-zinc-300">user</strong> (patient portal).
        </p>
      </div>

      {msg && (
        <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-amber-100/90" role="status">
          {msg}
        </p>
      )}

      <form
        onSubmit={createUser}
        className="rounded-2xl border border-amber-900/30 bg-stone-950/80 p-6"
      >
        <h2 className="text-lg font-semibold text-zinc-200">Invite new user</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-500">Email</span>
            <input
              required
              type="email"
              className="rounded-lg border border-amber-900/40 bg-black/30 px-3 py-2 text-zinc-100"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-500">Temporary password</span>
            <input
              required
              type="password"
              minLength={6}
              className="rounded-lg border border-amber-900/40 bg-black/30 px-3 py-2 text-zinc-100"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-500">Full name</span>
            <input
              className="rounded-lg border border-amber-900/40 bg-black/30 px-3 py-2 text-zinc-100"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-500">Role</span>
            <select
              className="rounded-lg border border-amber-900/40 bg-black/30 px-3 py-2 text-zinc-100"
              value={form.role}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  role: e.target.value as "user" | "admin" | "provider",
                }))
              }
            >
              <option value="user">User (patient)</option>
              <option value="provider">Provider</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-6 rounded-xl bg-amber-500 px-6 py-3 font-semibold text-stone-950 disabled:opacity-50"
        >
          Create user
        </button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-amber-900/30">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-amber-900/40 bg-stone-950/80 text-zinc-500">
            <tr>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-900/20">
            {rows.map((r) => (
              <tr key={r.id} className="bg-zinc-950/40">
                <td className="px-4 py-3 text-zinc-300">{r.email}</td>
                <td className="px-4 py-3 text-zinc-400">{r.name ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      r.role === "admin"
                        ? "rounded bg-amber-500/20 px-2 py-0.5 text-amber-300"
                        : "text-zinc-500"
                    }
                  >
                    {r.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {r.role !== "admin" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRole(r.id, "admin")}
                        className="rounded-lg border border-amber-700/50 px-3 py-1 text-xs text-amber-300 hover:bg-amber-500/10"
                      >
                        Make admin
                      </button>
                    )}
                    {r.role === "admin" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRole(r.id, "user")}
                        className="rounded-lg border border-zinc-600 px-3 py-1 text-xs text-zinc-400 hover:bg-white/5"
                      >
                        Remove admin
                      </button>
                    )}
                    {r.role !== "provider" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRole(r.id, "provider")}
                        className="rounded-lg border border-emerald-800/50 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
                      >
                        Set provider
                      </button>
                    )}
                    {r.role === "provider" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRole(r.id, "user")}
                        className="rounded-lg border border-zinc-600 px-3 py-1 text-xs text-zinc-400 hover:bg-white/5"
                      >
                        Set patient
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
