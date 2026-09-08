"""SHAP explanation is structured, bounded and failure-tolerant."""

from __future__ import annotations

import pandas as pd
import pytest
from sklearn.ensemble import RandomForestClassifier

from ml.config import ALL_INPUT_FEATURES
from ml.data.synthetic import generate_synthetic_dataset
from ml.explainability.shap_explainer import explain_model_prediction
from ml.preprocessing.pipeline import build_pipeline


@pytest.fixture(scope="module")
def pipeline():
    df = generate_synthetic_dataset(2000, seed=3)
    pipe = build_pipeline(RandomForestClassifier(n_estimators=50, random_state=3), use_text=False)
    pipe.fit(df[ALL_INPUT_FEATURES], df["esi"] - 1)
    return pipe


def _row():
    return pd.DataFrame(
        [
            {
                "age": 68, "sex": "M", "arrival_transport": "ambulance",
                "chief_complaint": "chest pain", "heart_rate": 124,
                "respiratory_rate": 27, "systolic_bp": 92, "diastolic_bp": 58,
                "oxygen_saturation": 89, "temperature": 37.7, "pain_level": 8,
            }
        ]
    )


def test_explanation_is_structured(pipeline):
    out = explain_model_prediction(pipeline, _row(), predicted_esi=2, top_n=4)
    assert out["method"] in {"shap", "none"}
    assert len(out["top_features"]) <= 4
    for item in out["top_features"]:
        assert item["impact"] in {"increased_acuity", "decreased_acuity", "neutral"}
        assert 0.0 <= item["importance"] <= 1.0
        assert "feature" in item
    assert "disclaimer" in out


def test_explanation_returns_none_on_bad_model():
    class Broken:
        def __getitem__(self, _):
            raise RuntimeError("boom")

    out = explain_model_prediction(Broken(), _row(), predicted_esi=3)
    assert out["method"] == "none"
    assert out["top_features"] == []
