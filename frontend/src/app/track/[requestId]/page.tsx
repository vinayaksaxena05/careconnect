"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";

const TrackMap = dynamic(() => import("@/components/TrackMap").then((m) => m.TrackMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)]">
      Loading map…
    </div>
  ),
});

type TrackPayload = {
  request_id: string;
  status: string;
  eta_minutes: number;
  destination: { lat: number; lng: number };
  ambulance: { lat: number; lng: number };
  route?: [number, number][];
  tracking_closed?: boolean;
  updated_at: string;
};

export default function TrackPage() {
  const params = useParams();
  const requestId = params.requestId as string;
  const { user, loading, getAccessToken } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<TrackPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || !requestId) return;
    const t = getAccessToken();
    if (!t) return;

    let cancelled = false;

    async function tick() {
      try {
        const payload = await apiFetch<TrackPayload>(`/api/requests/${requestId}/track`, t);
        if (!cancelled) {
          setData(payload);
          setErr(null);
          setClosed(false);
        }
      } catch (e) {
        const msg = (e as Error).message;
        if (!cancelled) {
          if (/no longer available|after payment|410/i.test(msg)) {
            setClosed(true);
            setErr(null);
          } else {
            setErr(msg);
          }
        }
      }
    }

    tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user, requestId, getAccessToken]);

  if (loading || !user) {
    return <div className="py-24 text-center text-[var(--cc-muted)]">Loading…</div>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold md:text-3xl">Live tracking</h1>
        <Link
          href="/book"
          className="focus-ring rounded-xl border border-[var(--cc-border)] px-5 py-3 font-medium"
        >
          Back to bookings
        </Link>
      </div>

      {err && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-red-200" role="alert">
          {err}
        </p>
      )}

      {closed && (
        <div className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-8">
          <p className="text-lg font-semibold text-[var(--cc-text)]">Tracking closed</p>
          <p className="mt-2 text-[var(--cc-muted)]">
            Live map tracking ends after payment is completed for this visit.
          </p>
          <Link
            href="/book"
            className="focus-ring mt-6 inline-block rounded-xl bg-[var(--cc-accent)] px-6 py-3 font-semibold text-zinc-950"
          >
            Back to bookings
          </Link>
        </div>
      )}

      {data && !closed && (
        <>
          <div className="flex flex-wrap gap-8 rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-8">
            <div>
              <p className="text-sm text-[var(--cc-muted)]">Status</p>
              <p className="text-2xl font-semibold capitalize">{data.status}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--cc-muted)]">ETA</p>
              <p className="text-2xl font-semibold text-[var(--cc-accent)]">
                ~{data.eta_minutes} min
              </p>
            </div>
            <div>
              <p className="text-sm text-[var(--cc-muted)]">Last update</p>
              <p className="text-lg">{new Date(data.updated_at).toLocaleTimeString()}</p>
            </div>
          </div>
          <TrackMap
            dest={data.destination}
            ambulance={data.ambulance}
            route={data.route}
          />
          <p className="text-sm text-[var(--cc-muted)]">
            Positions update every few seconds for this demo. Production would stream GPS from field
            units via Supabase Realtime.
          </p>
        </>
      )}
    </div>
  );
}
