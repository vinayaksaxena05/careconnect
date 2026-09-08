# Features & data-leakage policy

The model answers the real-world triage question:

> Given only what is known at the initial emergency triage assessment, what ESI
> acuity (1-5) should this patient receive?

Every feature below is available **at the moment of triage**, before any
diagnosis, treatment, disposition or later observation.

## Features used

| Feature | Type | Source (MIMIC-IV-ED) | Available at triage because... |
|---|---|---|---|
| `age` | numeric | `patients.anchor_age` (via `edstays.subject_id`) | Demographic, known on registration. |
| `sex` | categorical | `edstays.gender` | Demographic, known on registration. |
| `arrival_transport` | categorical | `edstays.arrival_transport` | Recorded when the patient arrives, before triage. |
| `chief_complaint` | text | `triage.chiefcomplaint` | Stated by the patient at triage; TF-IDF vectorised. |
| `heart_rate` | numeric | `triage.heartrate` | First vital signs, taken at triage. |
| `respiratory_rate` | numeric | `triage.resprate` | First vital signs, taken at triage. |
| `oxygen_saturation` | numeric | `triage.o2sat` | First vital signs, taken at triage. |
| `systolic_bp` | numeric | `triage.sbp` | First vital signs, taken at triage. |
| `diastolic_bp` | numeric | `triage.dbp` | First vital signs, taken at triage. |
| `temperature` | numeric | `triage.temperature` (°F → °C) | First vital signs, taken at triage. |
| `pain_level` | numeric | `triage.pain` (free text → 0-10) | Asked at triage. |

### Derived (deterministic, from the above only)

| Feature | Definition |
|---|---|
| `shock_index` | `heart_rate / systolic_bp` |
| `pulse_pressure` | `systolic_bp - diastolic_bp` |

## Target

`esi` = `triage.acuity` - the ESI level (1-5) the triage nurse assigned at
triage. Multiclass. ESI 1-2 ("high acuity") is evaluated separately because
missing those patients is the costliest error.

## Explicitly excluded (would leak the outcome)

Never read from any table, because they are recorded *after* the triage
decision:

- final `diagnosis` / ICD codes
- `disposition` (admitted / discharged / transferred / expired)
- ICU admission, `hospital_expire_flag`, mortality
- length of stay
- `medrecon`, `pyxis` (medications reconciled / dispensed in the ED)
- `vitalsign` (repeated vitals taken *during* the ED stay - only the single
  `triage` row is used)
- later laboratory results
- later clinical notes / provider notes
- anything charted during or after treatment

## Preprocessing & leakage from data handling

- The train/validation/test split happens **before** any fitting.
- Imputer medians, `StandardScaler` statistics, `OneHotEncoder` categories and
  `TfidfVectorizer` vocabulary/IDF are fit **only on the training split** and
  are part of the serialized pipeline.
- Out-of-range physiological values are treated as recording errors (clipped to
  NaN, then imputed), documented, and never silently dropped.
