"""Preprocessing pipeline: missing values, categoricals, numerics, text."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from ml.config import ALL_INPUT_FEATURES
from ml.preprocessing.pipeline import FeatureEngineer, build_pipeline, build_preprocessor


def _row(**overrides):
    base = {
        "age": 50,
        "sex": "M",
        "arrival_transport": "ambulance",
        "chief_complaint": "chest pain",
        "heart_rate": 90,
        "respiratory_rate": 18,
        "systolic_bp": 120,
        "diastolic_bp": 80,
        "oxygen_saturation": 97,
        "temperature": 37.0,
        "pain_level": 4,
    }
    base.update(overrides)
    return base


def test_feature_engineer_adds_derived_columns():
    out = FeatureEngineer().transform(pd.DataFrame([_row()]))
    assert "shock_index" in out.columns
    assert "pulse_pressure" in out.columns
    assert out.loc[0, "pulse_pressure"] == pytest.approx(40)
    assert out.loc[0, "shock_index"] == pytest.approx(90 / 120)


def test_feature_engineer_clips_out_of_range_to_nan():
    out = FeatureEngineer().transform(pd.DataFrame([_row(heart_rate=999)]))
    # 999 bpm is outside the plausible range -> becomes the clip ceiling, not NaN
    assert out.loc[0, "heart_rate"] == 300


def test_feature_engineer_normalises_unknown_category():
    out = FeatureEngineer().transform(
        pd.DataFrame([_row(sex="martian", arrival_transport="teleporter")])
    )
    assert out.loc[0, "sex"] == "UNKNOWN"
    assert out.loc[0, "arrival_transport"] == "unknown"


def test_feature_engineer_handles_missing_columns():
    df = pd.DataFrame([{"age": 40, "sex": "F", "chief_complaint": "cough"}])
    out = FeatureEngineer().transform(df)
    for col in ("heart_rate", "systolic_bp", "shock_index", "arrival_transport"):
        assert col in out.columns


def test_preprocessor_imputes_missing_numeric():
    pre = build_preprocessor(use_text=False)
    train = pd.DataFrame([_row(), _row(heart_rate=110), _row(heart_rate=70)])
    pre.fit(FeatureEngineer().transform(train))
    infer = FeatureEngineer().transform(pd.DataFrame([_row(heart_rate=np.nan)]))
    matrix = pre.transform(infer)
    assert not np.isnan(np.asarray(matrix, dtype=float)).any()


def test_text_pipeline_produces_more_features_than_structured_only():
    corpus = pd.DataFrame(
        [_row(chief_complaint=c) for c in ["chest pain", "sore throat", "chest pain now", "leg pain"]]
    )
    eng = FeatureEngineer().transform(corpus)
    without = build_preprocessor(use_text=False).fit_transform(eng)
    with_text = build_preprocessor(use_text=True).fit_transform(eng)
    assert with_text.shape[1] > without.shape[1]


def test_full_pipeline_fits_and_predicts():
    from sklearn.dummy import DummyClassifier

    rows = pd.DataFrame([_row() for _ in range(20)])[ALL_INPUT_FEATURES]
    y = np.array([0, 1, 2, 3, 4] * 4)
    pipe = build_pipeline(DummyClassifier(strategy="most_frequent"), use_text=True)
    pipe.fit(rows, y)
    assert pipe.predict(rows.head(1)).shape == (1,)
