"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

type Stats = {
  profiles: number;
  admins: number;
  healthcare_providers: number;
  service_types: number;
  service_requests: number;
};

export default function AdminHomePage() {
  const { loading } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [me, setMe] = useState<{ email?: string | null; name?: string | null } | null>(
    null,
  );
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    void (async () => {
      const { data: { session } } = await getSupabaseBrowser().auth.getSession();
      const t = session?.access_token;
      if (!t) return;
      try {
        const [s, m] = await Promise.all([
          apiFetch<Stats>("/api/admin/stats", t),
          apiFetch<{ email?: string | null; name?: string | null }>("/api/admin/me", t),
        ]);
        setStats(s);
        setMe(m);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
  }, [loading]);

  if (err) {
    return <p className="text-red-400">{err}</p>;
  }

  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <h1 className="text-3xl font-bold text-amber-400">Master dashboard</h1>
        <p className="mt-2 text-zinc-400">
          Signed in as <span className="text-zinc-200">{me?.email}</span>
          {me?.name ? ` · ${me.name}` : ""}
        </p>
      </div>

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Patient profiles", stats.profiles],
            ["Administrators", stats.admins],
            ["Facilities (providers)", stats.healthcare_providers],
            ["Service types", stats.service_types],
            ["Service requests", stats.service_requests],
          ].map(([label, n]) => (
            <div
              key={String(label)}
              className="rounded-2xl border border-amber-900/30 bg-stone-950/80 p-6"
            >
              <p className="text-sm text-zinc-500">{label}</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-amber-200">{n}</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-amber-900/20 bg-amber-500/5 p-6 text-sm text-zinc-400">
        Use the sidebar to <strong className="text-zinc-300">invite users</strong>, assign{" "}
        <strong className="text-zinc-300">administrators</strong>, manage{" "}
        <strong className="text-zinc-300">facilities</strong> (healthcare providers), and edit the{" "}
        <strong className="text-zinc-300">service catalog</strong>. All actions require a valid
        admin session and run through the Node API with your service role.
      </div>
    </div>
  );
}
