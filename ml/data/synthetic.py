"""Reproducible synthetic ED triage dataset.

MIMIC-IV-ED is credentialed and must not live in this repo, so this module
generates a stand-in with the *same schema and column semantics* as the real
extractor (:mod:`ml.data.mimic`). It lets the full train -> evaluate -> select
-> serialize pipeline run end to end and lets the API serve a real model.

It is emphatically **not** clinically valid. The generative process is a
transparent hand-built scorecard: vitals and a chief complaint are sampled from
a latent severity, then ESI is assigned from a blend of vital-sign danger and
complaint red-flags plus noise. Text carries genuine signal so the structured
vs. structured+TF-IDF comparison is meaningful.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from ml.config import RANDOM_SEED

# Chief complaints grouped by the acuity they typically imply. A little
# cross-contamination keeps the text signal realistic rather than perfectly
# separable.
_COMPLAINTS: dict[str, list[str]] = {
    "critical": [
        "cardiac arrest",
        "not breathing",
        "unresponsive",
        "major trauma",
        "severe bleeding uncontrolled",
        "anaphylaxis",
        "active seizure",
        "overdose unresponsive",
    ],
    "high": [
        "chest pain",
        "shortness of breath",
        "difficulty breathing",
        "stroke symptoms facial droop",
        "severe abdominal pain",
        "altered mental status",
        "syncope",
        "high fever with lethargy",
        "allergic reaction swelling",
    ],
    "moderate": [
        "abdominal pain",
        "fever and cough",
        "vomiting and diarrhea",
        "flank pain",
        "headache",
        "back pain",
        "laceration needs sutures",
        "dizziness",
        "urinary symptoms",
    ],
    "low": [
        "sore throat",
        "ear pain",
        "medication refill",
        "rash",
        "ankle sprain",
        "cold symptoms",
        "suture removal",
        "prescription request",
        "minor cut",
    ],
}

_SEX_CHOICES = ["M", "F"]
_ARRIVAL_BY_SEVERITY = {
    "critical": (["ambulance", "helicopter", "police"], [0.8, 0.12, 0.08]),
    "high": (["ambulance", "walk_in", "private"], [0.55, 0.3, 0.15]),
    "moderate": (["walk_in", "private", "ambulance", "public"], [0.5, 0.25, 0.15, 0.1]),
    "low": (["walk_in", "public", "private"], [0.7, 0.2, 0.1]),
}

# P(latent severity band). ESI 3 dominates real EDs; ESI 1 is rare.
_SEVERITY_P = {"critical": 0.025, "high": 0.17, "moderate": 0.52, "low": 0.285}

# (mean, sd) per vital, per severity band. Celsius for temperature.
_VITALS_BY_SEVERITY = {
    "critical": {
        "heart_rate": (132, 28),
        "respiratory_rate": (30, 8),
        "systolic_bp": (88, 26),
        "diastolic_bp": (55, 16),
        "oxygen_saturation": (86, 7),
        "temperature": (37.6, 1.6),
        "pain_level": (7.5, 2.5),
    },
    "high": {
        "heart_rate": (108, 20),
        "respiratory_rate": (23, 5),
        "systolic_bp": (128, 24),
        "diastolic_bp": (78, 14),
        "oxygen_saturation": (93, 4),
        "temperature": (37.4, 1.1),
        "pain_level": (6.0, 2.4),
    },
    "moderate": {
        "heart_rate": (90, 16),
        "respiratory_rate": (18, 3),
        "systolic_bp": (132, 18),
        "diastolic_bp": (82, 11),
        "oxygen_saturation": (97, 2),
        "temperature": (37.1, 0.8),
        "pain_level": (4.5, 2.5),
    },
    "low": {
        "heart_rate": (78, 12),
        "respiratory_rate": (16, 2),
        "systolic_bp": (126, 14),
        "diastolic_bp": (79, 9),
        "oxygen_saturation": (98, 1.2),
        "temperature": (36.9, 0.5),
        "pain_level": (2.2, 2.0),
    },
}

_RED_FLAG_TOKENS = (
    "arrest",
    "not breathing",
    "unresponsive",
    "trauma",
    "bleeding",
    "anaphylaxis",
    "seizure",
    "overdose",
    "chest pain",
    "shortness of breath",
    "difficulty breathing",
    "stroke",
    "altered mental",
    "syncope",
)
_LOW_ACUITY_TOKENS = (
    "refill",
    "prescription",
    "suture removal",
    "rash",
    "sore throat",
    "cold symptoms",
    "ear pain",
    "minor cut",
)


# Triage-nurse gestalt / expected-resource baseline per latent band. ESI is
# not a pure function of vitals, so a band offset anchors the mapping while the
# vital-sign and complaint terms still move individual cases up or down.
_BASE_BY_SEVERITY = {"critical": 6.6, "high": 3.5, "moderate": 1.8, "low": -1.3}


def _danger_score(row: dict, band: str, rng: np.random.Generator) -> float:
    """Higher -> sicker. Loosely mirrors the vital-sign cues ESI uses."""
    s = _BASE_BY_SEVERITY[band]
    spo2 = row["oxygen_saturation"]
    s += 4.0 if spo2 < 85 else 2.5 if spo2 < 90 else 1.0 if spo2 < 94 else 0.0

    sbp = row["systolic_bp"]
    s += 3.5 if sbp < 80 else 2.0 if sbp < 95 else 0.8 if sbp < 105 else 0.0

    hr = row["heart_rate"]
    s += 3.0 if (hr > 150 or hr < 40) else 1.5 if (hr > 120 or hr < 50) else 0.0

    rr = row["respiratory_rate"]
    s += 3.0 if (rr > 34 or rr < 8) else 1.5 if (rr > 26 or rr < 10) else 0.0

    temp = row["temperature"]
    s += 1.5 if (temp >= 40 or temp <= 34) else 0.6 if (temp >= 38.5) else 0.0

    s += 0.9 if row["pain_level"] >= 8 else 0.3 if row["pain_level"] >= 5 else 0.0

    age = row["age"]
    s += 0.8 if (age >= 75 or age <= 1) else 0.3 if age >= 65 else 0.0

    cc = row["chief_complaint"]
    if any(tok in cc for tok in _RED_FLAG_TOKENS):
        s += 3.2
    if any(tok in cc for tok in _LOW_ACUITY_TOKENS):
        s -= 2.0

    s += rng.normal(0, 0.9)  # irreducible triage noise
    return s


def _score_to_esi(score: float) -> int:
    if score >= 9.6:
        return 1
    if score >= 4.0:
        return 2
    if score >= 1.2:
        return 3
    if score >= -2.0:
        return 4
    return 5


def generate_synthetic_dataset(
    n_samples: int = 12000, seed: int = RANDOM_SEED
) -> pd.DataFrame:
    """Return a DataFrame with every column the model consumes plus ``esi``."""
    rng = np.random.default_rng(seed)
    bands = list(_SEVERITY_P)
    band_p = np.array([_SEVERITY_P[b] for b in bands])
    drawn = rng.choice(bands, size=n_samples, p=band_p)

    rows: list[dict] = []
    for band in drawn:
        # 12% of complaints come from a neighbouring band.
        if rng.random() < 0.12:
            band_cc = rng.choice(bands)
        else:
            band_cc = band
        complaint = rng.choice(_COMPLAINTS[band_cc])

        vit = _VITALS_BY_SEVERITY[band]
        row: dict = {
            "age": int(np.clip(rng.normal(48, 21), 0, 105)),
            "sex": rng.choice(_SEX_CHOICES),
            "arrival_transport": rng.choice(
                _ARRIVAL_BY_SEVERITY[band][0], p=_ARRIVAL_BY_SEVERITY[band][1]
            ),
            "chief_complaint": complaint,
        }
        for vital, (mu, sd) in vit.items():
            row[vital] = float(np.round(rng.normal(mu, sd), 1))
        row["heart_rate"] = float(np.clip(row["heart_rate"], 20, 240))
        row["respiratory_rate"] = float(np.clip(row["respiratory_rate"], 4, 60))
        row["systolic_bp"] = float(np.clip(row["systolic_bp"], 50, 250))
        row["diastolic_bp"] = float(np.clip(row["diastolic_bp"], 25, 160))
        row["oxygen_saturation"] = float(np.clip(row["oxygen_saturation"], 60, 100))
        row["temperature"] = float(np.clip(row["temperature"], 32, 43))
        row["pain_level"] = int(np.clip(round(row["pain_level"]), 0, 10))

        row["esi"] = _score_to_esi(_danger_score(row, band, rng))
        rows.append(row)

    df = pd.DataFrame(rows)

    # Inject realistic missingness: vitals are not always all captured at triage.
    for col, frac in {
        "temperature": 0.08,
        "respiratory_rate": 0.05,
        "diastolic_bp": 0.06,
        "pain_level": 0.10,
        "oxygen_saturation": 0.03,
    }.items():
        mask = rng.random(len(df)) < frac
        df.loc[mask, col] = np.nan

    return df.sample(frac=1.0, random_state=seed).reset_index(drop=True)
