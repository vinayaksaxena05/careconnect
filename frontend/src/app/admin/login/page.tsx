"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export default function AdminLoginPage() {
  const { signIn, user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    void (async () => {
      const { data: { session } } = await getSupabaseBrowser().auth.getSession();
      const t = session?.access_token;
      if (!t) return;
      try {
        await apiFetch("/api/admin/me", t);
        router.replace("/admin");
      } catch {
        /* not an admin — stay on login */
      }
    })();
  }, [loading, user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setPending(true);
    try {
      const { error } = await signIn(email, password);
      if (error) {
        setMsg(error);
        return;
      }
      const { data: { session } } = await getSupabaseBrowser().auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setMsg("Could not read session. Try again.");
        return;
      }
      await apiFetch("/api/admin/me", token);
      router.replace("/admin");
    } catch (e) {
      const m = (e as Error).message;
      setMsg(
        m === "Admin access required"
          ? "This account is not an administrator."
          : m || "Access denied",
      );
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0c0a09] text-zinc-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0c0a09] px-4 py-16 text-zinc-100">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-amber-900/40 bg-stone-950 p-8 shadow-xl shadow-black/40">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-amber-500">
          CareConnect
        </p>
        <h1 className="mt-2 text-center text-2xl font-bold text-amber-400">Administrator login</h1>
        <p className="mt-2 text-center text-sm text-zinc-500">
          Separate sign-in for master dashboard. Use an account with admin role.
        </p>

        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Email</span>
            <input
              type="email"
              required
              autoComplete="username"
              className="rounded-xl border border-amber-900/40 bg-black/40 px-4 py-3 text-lg text-zinc-100 outline-none focus:ring-2 focus:ring-amber-500/50"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm text-zinc-400">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              className="rounded-xl border border-amber-900/40 bg-black/40 px-4 py-3 text-lg text-zinc-100 outline-none focus:ring-2 focus:ring-amber-500/50"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {msg && (
            <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">
              {msg}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="min-h-[52px] rounded-xl bg-amber-500 font-semibold text-stone-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {pending ? "Signing in…" : "Enter admin dashboard"}
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-zinc-500">
          <Link href="/login" className="text-emerald-400 hover:underline">
            Patient / public login
          </Link>
          {" · "}
          <Link href="/" className="text-zinc-400 hover:underline">
            Home
          </Link>
        </p>
      </div>
    </div>
  );
}
