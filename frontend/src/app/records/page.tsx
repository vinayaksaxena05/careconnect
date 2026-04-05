"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";

type RecordRow = {
  record_id: string;
  diagnosis: string;
  notes: string | null;
  record_date: string;
};

export default function RecordsPage() {
  const { user, loading, getAccessToken } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const t = getAccessToken();
    if (!t) return;
    apiFetch<RecordRow[]>("/api/me/medical-records", t)
      .then(setRows)
      .catch((e: Error) => setMsg(e.message));
  }, [user, getAccessToken]);

  async function addRecord(e: React.FormEvent) {
    e.preventDefault();
    const t = getAccessToken();
    if (!t || !diagnosis.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch("/api/me/medical-records", t, {
        method: "POST",
        body: JSON.stringify({
          diagnosis: diagnosis.trim(),
          notes: notes.trim() || null,
        }),
      });
      setDiagnosis("");
      setNotes("");
      setRows(await apiFetch("/api/me/medical-records", t));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="py-24 text-center text-[var(--cc-muted)]">Loading…</div>;
  }

  return (
    <div className="flex flex-col gap-12">
      <div>
        <h1 className="text-3xl font-bold md:text-4xl">Medical records</h1>
        <p className="mt-2 text-lg text-[var(--cc-muted)]">
          Mirrors the <code className="text-[var(--cc-accent)]">medical_records</code> table from your
          normalized schema — visible only to you under RLS.
        </p>
      </div>

      {msg && (
        <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-amber-200" role="alert">
          {msg}
        </p>
      )}

      <form
        onSubmit={addRecord}
        className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-8"
      >
        <h2 className="text-xl font-semibold text-[var(--cc-accent)]">Add a note</h2>
        <p className="mt-1 text-sm text-[var(--cc-muted)]">
          For coursework you can log summary diagnoses; production apps would restrict entry to
          clinicians.
        </p>
        <label className="mt-6 flex flex-col gap-2">
          <span className="font-medium">Diagnosis or visit summary</span>
          <input
            className="focus-ring min-h-[52px] rounded-xl border border-[var(--cc-border)] bg-[var(--cc-bg)] px-4 text-lg"
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder="e.g. Hypertension review"
          />
        </label>
        <label className="mt-4 flex flex-col gap-2">
          <span className="font-medium">Notes (optional)</span>
          <textarea
            className="focus-ring min-h-[100px] rounded-xl border border-[var(--cc-border)] bg-[var(--cc-bg)] px-4 py-3 text-lg"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="focus-ring mt-6 min-h-[52px] rounded-xl bg-[var(--cc-accent)] px-8 text-lg font-semibold text-zinc-950 disabled:opacity-60"
        >
          Save record
        </button>
      </form>

      <section>
        <h2 className="text-2xl font-bold">History</h2>
        <ul className="mt-6 flex flex-col gap-4">
          {rows.length === 0 && (
            <li className="text-[var(--cc-muted)]">No records stored yet.</li>
          )}
          {rows.map((r) => (
            <li
              key={r.record_id}
              className="rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-6"
            >
              <p className="text-lg font-semibold">{r.diagnosis}</p>
              <p className="text-sm text-[var(--cc-muted)]">{r.record_date}</p>
              {r.notes && <p className="mt-3 text-[var(--cc-text)] leading-relaxed">{r.notes}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
