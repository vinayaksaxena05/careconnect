"""Extract the training frame from a local MIMIC-IV-ED download.

This code is complete but is **not exercised in this repo** - MIMIC-IV-ED is
credentialed (PhysioNet) and is never committed. Point ``--data-dir`` at an
unpacked copy of ``mimic-iv-ed/2.2/ed`` to use it:

    python -m ml.training.train --source mimic --data-dir /path/to/mimic-iv-ed/ed

Only the ``triage`` table (recorded *at* triage) and arrival columns from
``edstays`` are read. Nothing recorded after the triage decision is touched -
see features.md for the per-column leakage justification.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

logger = logging.getLogger("ml.data.mimic")

# MIMIC-IV-ED column -> CareConnect feature name. Source tables:
#   edstays.csv.gz   : one row per ED stay (arrival/discharge admin data)
#   triage.csv.gz    : the single set of observations taken at triage
_TRIAGE_MAP = {
    "temperature": "temperature_f",   # MIMIC records Fahrenheit
    "heartrate": "heart_rate",
    "resprate": "respiratory_rate",
    "o2sat": "oxygen_saturation",
    "sbp": "systolic_bp",
    "dbp": "diastolic_bp",
    "pain": "pain_level",
    "acuity": "esi",                   # <- target (ESI assigned at triage)
    "chiefcomplaint": "chief_complaint",
}
_EDSTAYS_MAP = {
    "gender": "sex",
    "arrival_transport": "arrival_transport",
}


def _read(path: Path) -> pd.DataFrame:
    for candidate in (path, path.with_suffix(path.suffix + ".gz")):
        if candidate.exists():
            return pd.read_csv(candidate, low_memory=False)
    raise FileNotFoundError(f"Expected {path} (optionally .gz) - is --data-dir correct?")


def _coerce_pain(series: pd.Series) -> pd.Series:
    """`triage.pain` is free text ('7', 'denies', '8/10', ...)."""
    extracted = series.astype("string").str.extract(r"(\d+(?:\.\d+)?)")[0]
    return pd.to_numeric(extracted, errors="coerce").clip(0, 10)


def load_mimic_ed_dataset(data_dir: str | Path) -> pd.DataFrame:
    """Return a DataFrame with the model's input columns plus ``esi``."""
    root = Path(data_dir)
    edstays = _read(root / "edstays.csv")[["stay_id", *(_EDSTAYS_MAP)]]
    triage = _read(root / "triage.csv")[["stay_id", *(_TRIAGE_MAP)]]

    df = edstays.merge(triage, on="stay_id", how="inner")
    df = df.rename(columns={**_EDSTAYS_MAP, **_TRIAGE_MAP})

    # Fahrenheit -> Celsius.
    df["temperature"] = (pd.to_numeric(df["temperature_f"], errors="coerce") - 32) * 5 / 9
    df = df.drop(columns=["temperature_f"])

    df["pain_level"] = _coerce_pain(df["pain_level"])
    df["sex"] = df["sex"].astype("string").str.upper().str.strip()
    df["arrival_transport"] = (
        df["arrival_transport"].astype("string").str.lower().str.replace(" ", "_")
    )

    # Age is not in the ED module; join patients.anchor_age if a copy is present.
    patients_path = root / "patients.csv"
    if patients_path.exists() or patients_path.with_suffix(".csv.gz").exists():
        pts = _read(patients_path)[["subject_id", "anchor_age"]]
        if "subject_id" in edstays.columns:
            df = df.merge(
                edstays[["stay_id", "subject_id"]].merge(pts, on="subject_id"),
                on="stay_id",
                how="left",
            ).rename(columns={"anchor_age": "age"})
    if "age" not in df.columns:
        logger.warning("No patients table found - 'age' will be NaN (imputed at fit).")
        df["age"] = np.nan

    df["esi"] = pd.to_numeric(df["esi"], errors="coerce")
    before = len(df)
    df = df[df["esi"].isin([1, 2, 3, 4, 5])].copy()
    df["esi"] = df["esi"].astype(int)
    logger.info("Dropped %d rows with missing/invalid acuity", before - len(df))

    keep = [
        "age",
        "sex",
        "arrival_transport",
        "heart_rate",
        "respiratory_rate",
        "systolic_bp",
        "diastolic_bp",
        "oxygen_saturation",
        "temperature",
        "pain_level",
        "chief_complaint",
        "esi",
    ]
    return df[keep].reset_index(drop=True)
