import { apiFetch } from "@/lib/api";

/**
 * Client types and helpers for the emergency triage decision-support endpoint.
 * The API contract lives in `ml/README.md` (section 15); keep this in sync.
 */

export type TriageFeatures = {
  age: number;
  sex: string;
  arrival_transport: string;
  chief_complaint: string;
  heart_rate?: number | null;
  respiratory_rate?: number | null;
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  oxygen_saturation?: number | null;
  temperature?: number | null;
  pain_level?: number | null;
};

export type FeatureContribution = {
  feature: string;
  label?: string;
  impact: "increased_acuity" | "decreased_acuity" | "neutral";
  importance: number;
};

export type TriagePrediction = {
  prediction: { esi: number; label: string; esi_name: string };
  probabilities: Record<string, number>;
  confidence: number;
  explanation: {
    method: "shap" | "heuristic" | "none";
    top_features: FeatureContribution[];
    disclaimer: string;
  };
  model: { name: string; version: string; type: "ml" | "heuristic"; uses_text: boolean };
  requires_human_review: boolean;
  clinical_notice: string;
};

export type TriageRecord = {
  id: string;
  predicted_esi: number;
  human_final_esi: number | null;
  was_overridden: boolean;
  override_reason: string | null;
  model_name: string;
  model_version: string;
  created_at: string;
};

export type TriageHealth = {
  enabled: boolean;
  status: string;
  backend: string;
  model_name?: string;
  model_version?: string;
  model_type?: string;
  uses_text?: boolean;
  error?: string;
};

const CORE_VITALS: (keyof TriageFeatures)[] = [
  "heart_rate",
  "respiratory_rate",
  "systolic_bp",
  "diastolic_bp",
  "oxygen_saturation",
  "temperature",
];

export const MIN_VITALS = 3;

export function countVitals(f: Partial<TriageFeatures>): number {
  return CORE_VITALS.filter((k) => f[k] != null && f[k] !== ("" as unknown)).length;
}

/** Keys of `TriageFeatures` whose value type admits `null`. */
type NullableFeatureKey = {
  [K in keyof TriageFeatures]-?: null extends TriageFeatures[K] ? K : never;
}[keyof TriageFeatures];

const OPTIONAL_KEYS: NullableFeatureKey[] = [
  "heart_rate",
  "respiratory_rate",
  "systolic_bp",
  "diastolic_bp",
  "oxygen_saturation",
  "temperature",
  "pain_level",
];

/** Send `null` (not `NaN`/`""`/`undefined`) for blank optional vitals. */
function clean(f: TriageFeatures): TriageFeatures {
  const out: TriageFeatures = { ...f };
  for (const k of OPTIONAL_KEYS) {
    const v = out[k];
    if (v === undefined || v === null || (typeof v === "number" && Number.isNaN(v))) {
      out[k] = null;
    }
  }
  return out;
}

export function predictTriage(features: TriageFeatures, token: string | null) {
  return apiFetch<TriagePrediction>("/api/emergency/triage/predict", token, {
    method: "POST",
    body: JSON.stringify(clean(features)),
  });
}

export function saveTriage(
  body: {
    features: TriageFeatures;
    emergency_id?: string | null;
    human_final_esi?: number | null;
    override_reason?: string | null;
  },
  token: string | null,
) {
  return apiFetch<{ prediction: TriagePrediction; record: TriageRecord }>(
    "/api/emergency/triage",
    token,
    { method: "POST", body: JSON.stringify({ ...body, features: clean(body.features) }) },
  );
}

export function getTriageHealth(token: string | null) {
  return apiFetch<TriageHealth>("/api/emergency/triage/health", token);
}

export function esiTone(esi: number): string {
  if (esi <= 1) return "border-red-500/50 bg-red-500/10 text-red-200";
  if (esi === 2) return "border-orange-500/40 bg-orange-500/10 text-orange-200";
  if (esi === 3) return "border-amber-500/40 bg-amber-500/10 text-amber-100";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
}
