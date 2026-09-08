"use client";

import Link from "next/link";
import { useState } from "react";
import { apiPostPublic } from "@/lib/api-public";

export default function ProviderRegisterPage() {
  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    phone: "",
    address: "",
    specialization: "",
    license_number: "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await apiPostPublic<{ provider_id: string }>("/api/provider/register", form);
      setMsg(
        "Account created. Confirm your email if required, then sign in with the patient login page — you will be redirected to the provider dashboard.",
      );
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-3xl font-bold">Provider registration</h1>
      <p className="mt-2 text-[var(--cc-muted)]">
        List your practice without an admin. Your profile stays unverified until an administrator
        approves it in the catalogue.
      </p>

      <form
        onSubmit={onSubmit}
        className="mt-8 flex flex-col gap-4 rounded-2xl border border-[var(--cc-border)] bg-[var(--cc-surface)] p-8"
      >
        {([
          ["full_name", "Full name", "text", true],
          ["email", "Work email", "email", true],
          ["password", "Password (min 6)", "password", true],
          ["phone", "Phone", "tel", false],
          ["address", "Practice address", "text", false],
          ["specialization", "Specialization", "text", true],
          ["license_number", "License / registration number", "text", true],
        ] as const).map(([key, label, type, req]) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-sm text-[var(--cc-muted)]">{label}</span>
            <input
              required={req}
              type={type as string}
              className="focus-ring rounded-xl border border-[var(--cc-border)] bg-[var(--cc-bg)] px-4 py-3"
              value={form[key as keyof typeof form]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </label>
        ))}
        {msg && (
          <p
            className={`rounded-xl px-4 py-3 text-sm ${msg.startsWith("Account") ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-200"}`}
            role="status"
          >
            {msg}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="focus-ring mt-2 rounded-xl bg-[var(--cc-accent)] py-3 font-semibold text-zinc-950 disabled:opacity-60"
        >
          {busy ? "Creating…" : "Create provider account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--cc-muted)]">
        Already registered?{" "}
        <Link href="/login" className="text-[var(--cc-accent)] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
