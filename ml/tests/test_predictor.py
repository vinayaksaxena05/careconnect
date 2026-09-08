"""Predictor abstraction: loading, prediction, probabilities, malformed input."""

from __future__ import annotations

import pandas as pd
import pytest

from ml.config import ESI_CLASSES
from ml.data.synthetic import generate_synthetic_dataset
from ml.inference.model_loader import ModelUnavailableError
from ml.inference.predictor import (
    HeuristicTriagePredictor,
    ModelTriagePredictor,
    build_predictor,
)
from ml.inference.schemas import TriageInput

CRITICAL = {
    "age": 71,
    "sex": "M",
    "arrival_transport": "ambulance",
    "chief_complaint": "unresponsive not breathing",
    "heart_rate": 38,
    "respiratory_rate": 5,
    "systolic_bp": 70,
    "diastolic_bp": 40,
    "oxygen_saturation": 78,
    "temperature": 35.0,
    "pain_level": 0,
}
MINOR = {
    "age": 24,
    "sex": "F",
    "arrival_transport": "walk_in",
    "chief_complaint": "medication refill",
    "heart_rate": 72,
    "respiratory_rate": 15,
    "systolic_bp": 118,
    "diastolic_bp": 76,
    "oxygen_saturation": 99,
    "temperature": 36.8,
    "pain_level": 0,
}


# --------------------------------------------------------------------------- #
# Heuristic predictor
# --------------------------------------------------------------------------- #


def test_heuristic_probabilities_sum_to_one_and_cover_all_classes():
    proba = HeuristicTriagePredictor().predict_proba(CRITICAL)
    assert set(proba) == set(ESI_CLASSES)
    assert sum(proba.values()) == pytest.approx(1.0)


def test_heuristic_ranks_critical_above_minor():
    h = HeuristicTriagePredictor()
    assert h.predict(CRITICAL) < h.predict(MINOR)


def test_heuristic_predict_result_shape():
    r = HeuristicTriagePredictor().predict_result(CRITICAL)
    assert r["prediction"]["esi"] in ESI_CLASSES
    assert r["requires_human_review"] is True
    assert r["model"]["type"] == "heuristic"
    assert r["explanation"]["method"] == "heuristic"
    assert r["explanation"]["top_features"]


def test_heuristic_tolerates_missing_vitals():
    r = HeuristicTriagePredictor().predict_result(
        {"age": 50, "sex": "M", "arrival_transport": "walk_in",
         "chief_complaint": "ankle sprain", "heart_rate": 80}
    )
    assert r["prediction"]["esi"] in ESI_CLASSES


# --------------------------------------------------------------------------- #
# Model predictor (trained on synthetic data on the fly)
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def trained_pipeline():
    from sklearn.ensemble import RandomForestClassifier

    from ml.config import ALL_INPUT_FEATURES
    from ml.preprocessing.pipeline import build_pipeline

    df = generate_synthetic_dataset(2500, seed=1)
    pipe = build_pipeline(
        RandomForestClassifier(n_estimators=60, random_state=1), use_text=True
    )
    pipe.fit(df[ALL_INPUT_FEATURES], df["esi"] - 1)
    return pipe


def test_model_predictor_wraps_pipeline(trained_pipeline):
    from ml.inference.model_loader import LoadedModel

    pred = ModelTriagePredictor(
        LoadedModel(
            pipeline=trained_pipeline,
            metadata={"model_name": "rf", "model_version": "t", "uses_text": True},
            source_path=None,
        )
    )
    proba = pred.predict_proba(CRITICAL)
    assert set(proba) == set(ESI_CLASSES)
    assert sum(proba.values()) == pytest.approx(1.0, abs=1e-6)
    result = pred.predict_result(CRITICAL)
    assert result["prediction"]["esi"] in ESI_CLASSES
    assert result["model"]["type"] == "ml"


def test_model_predictor_explanation_never_raises(trained_pipeline):
    from ml.inference.model_loader import LoadedModel

    pred = ModelTriagePredictor(
        LoadedModel(trained_pipeline, {"uses_text": True}, None)
    )
    expl = pred.explain(MINOR)
    assert expl["method"] in {"shap", "none"}


# --------------------------------------------------------------------------- #
# Factory
# --------------------------------------------------------------------------- #


def test_build_predictor_disabled_returns_none():
    assert build_predictor(enabled=False) is None


def test_build_predictor_heuristic_backend():
    p = build_predictor(enabled=True, backend="heuristic")
    assert isinstance(p, HeuristicTriagePredictor)


def test_build_predictor_model_backend_missing_artifact_raises(tmp_path):
    with pytest.raises(ModelUnavailableError):
        build_predictor(
            enabled=True, backend="model", model_path=str(tmp_path / "nope.joblib")
        )


def test_build_predictor_auto_falls_back_to_heuristic(tmp_path, monkeypatch):
    import ml.inference.predictor as mod

    monkeypatch.setattr(mod, "resolve_model_path", lambda _p: None)
    p = build_predictor(enabled=True, backend="auto")
    assert isinstance(p, HeuristicTriagePredictor)


# --------------------------------------------------------------------------- #
# Input validation
# --------------------------------------------------------------------------- #


def test_triage_input_rejects_impossible_vital():
    with pytest.raises(ValueError):
        TriageInput(
            age=40, sex="M", arrival_transport="ambulance", chief_complaint="x",
            heart_rate=999, respiratory_rate=18, systolic_bp=120,
        )


def test_triage_input_requires_min_vitals():
    with pytest.raises(ValueError):
        TriageInput(age=40, sex="M", arrival_transport="ambulance", chief_complaint="x")


def test_triage_input_normalises_categoricals():
    got = TriageInput(
        age=40, sex="female", arrival_transport="EMS", chief_complaint="cough",
        heart_rate=88, respiratory_rate=16, oxygen_saturation=98,
    )
    assert got.sex == "F"
    assert got.arrival_transport == "ambulance"
