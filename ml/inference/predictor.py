"""The ``TriagePredictor`` abstraction the backend depends on.

Two implementations behind one interface:

* :class:`ModelTriagePredictor` - wraps a serialized scikit-learn / XGBoost
  pipeline loaded from disk.
* :class:`HeuristicTriagePredictor` - a transparent rule-based fallback
  (``heuristic-v0``) so the endpoint works with no artifact present. It is
  explicitly *not* machine learning and says so in its output.

``build_predictor`` picks one based on config. The API and UI never see the
difference beyond the ``model.type`` field.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any

import pandas as pd

from ml.config import (
    ALL_INPUT_FEATURES,
    CLINICAL_NOTICE,
    ESI_CLASSES,
    ESI_NAMES,
    TEXT_FEATURE,
    acuity_band,
)
from ml.explainability.shap_explainer import explain_model_prediction
from ml.inference.model_loader import LoadedModel, ModelUnavailableError, load_model, resolve_model_path

logger = logging.getLogger("ml.inference.predictor")

ESI_OFFSET = 1  # model classes are 0-indexed


def _to_frame(features: Mapping[str, Any]) -> pd.DataFrame:
    row = {col: features.get(col) for col in ALL_INPUT_FEATURES}
    if not row.get(TEXT_FEATURE):
        row[TEXT_FEATURE] = ""
    return pd.DataFrame([row])


def _assemble_result(
    *,
    esi: int,
    proba: dict[int, float],
    explanation: dict,
    name: str,
    version: str,
    kind: str,
    uses_text: bool,
) -> dict:
    esi = int(esi)
    return {
        "prediction": {
            "esi": esi,
            "label": acuity_band(esi),
            "esi_name": ESI_NAMES[esi],
        },
        "probabilities": {str(k): round(float(v), 4) for k, v in sorted(proba.items())},
        "confidence": round(float(proba.get(esi, 0.0)), 4),
        "explanation": explanation,
        "model": {
            "name": name,
            "version": version,
            "type": kind,
            "uses_text": bool(uses_text),
        },
        "requires_human_review": True,
        "clinical_notice": CLINICAL_NOTICE,
    }


class TriagePredictor(ABC):
    """Stable inference contract. Implementations must not leak sklearn types."""

    name: str = "abstract"
    version: str = "0"
    kind: str = "ml"
    uses_text: bool = False

    @abstractmethod
    def predict_proba(self, features: Mapping[str, Any]) -> dict[int, float]:
        """ESI -> probability, over classes 1..5, summing to ~1."""

    def predict(self, features: Mapping[str, Any]) -> int:
        proba = self.predict_proba(features)
        return int(max(proba, key=proba.get))

    def explain(
        self, features: Mapping[str, Any], *, predicted_esi: int | None = None
    ) -> dict:  # noqa: D401
        return {"method": "none", "top_features": [], "disclaimer": ""}

    def predict_result(self, features: Mapping[str, Any]) -> dict:
        """Full response payload (prediction + probabilities + explanation)."""
        proba = self.predict_proba(features)
        esi = int(max(proba, key=proba.get))
        explanation = self.explain(features, predicted_esi=esi)
        return _assemble_result(
            esi=esi,
            proba=proba,
            explanation=explanation,
            name=self.name,
            version=self.version,
            kind=self.kind,
            uses_text=self.uses_text,
        )


class ModelTriagePredictor(TriagePredictor):
    kind = "ml"

    def __init__(self, loaded: LoadedModel) -> None:
        self._pipeline = loaded.pipeline
        self.metadata = loaded.metadata
        self.name = loaded.metadata.get("model_name", "model")
        self.version = loaded.metadata.get("model_version", "v?")
        self.uses_text = bool(loaded.metadata.get("uses_text", False))
        classes = getattr(self._pipeline, "classes_", None)
        self._esi_for_index = (
            [int(c) + ESI_OFFSET for c in classes] if classes is not None else ESI_CLASSES
        )

    def predict_proba(self, features: Mapping[str, Any]) -> dict[int, float]:
        proba = self._pipeline.predict_proba(_to_frame(features))[0]
        out = {esi: 0.0 for esi in ESI_CLASSES}
        for esi, p in zip(self._esi_for_index, proba):
            out[int(esi)] = float(p)
        return out

    def explain(self, features: Mapping[str, Any], *, predicted_esi: int | None = None) -> dict:
        if predicted_esi is None:
            predicted_esi = self.predict(features)
        return explain_model_prediction(self._pipeline, _to_frame(features), predicted_esi)


class HeuristicTriagePredictor(TriagePredictor):
    """Rule-based ESI estimate. Deterministic, no training, no data.

    A coarse encoding of ESI decision points (airway/breathing/circulation
    danger + red-flag complaints). Probabilities are indicative confidence
    weights, not calibrated.
    """

    name = "rule-based-esi"
    version = "heuristic-v0"
    kind = "heuristic"
    uses_text = True

    _RED_FLAGS = (
        "arrest", "not breathing", "unresponsive", "apnea", "no pulse",
    )
    _EMERGENT = (
        "chest pain", "shortness of breath", "difficulty breathing", "sob",
        "stroke", "facial droop", "seizure", "overdose", "severe bleeding",
        "anaphylaxis", "altered mental", "syncope", "suicidal",
    )
    _MINOR = (
        "medication refill", "prescription", "suture removal", "form",
        "work note", "rash", "sore throat", "ear pain", "cold symptoms",
    )

    def _reasons(self, f: Mapping[str, Any]) -> list[tuple[str, str, float]]:
        """(feature, impact, weight) tuples for the rules that fired."""
        reasons: list[tuple[str, str, float]] = []

        def num(key):
            v = f.get(key)
            try:
                return float(v) if v is not None else None
            except (TypeError, ValueError):
                return None

        spo2, sbp, hr = num("oxygen_saturation"), num("systolic_bp"), num("heart_rate")
        rr, temp, pain = num("respiratory_rate"), num("temperature"), num("pain_level")
        cc = str(f.get("chief_complaint") or "").lower()

        if spo2 is not None and spo2 < 85:
            reasons.append(("oxygen_saturation", "increased_acuity", 3.0))
        elif spo2 is not None and spo2 < 92:
            reasons.append(("oxygen_saturation", "increased_acuity", 1.6))
        if sbp is not None and sbp < 90:
            reasons.append(("systolic_bp", "increased_acuity", 2.4))
        if hr is not None and (hr > 130 or hr < 45):
            reasons.append(("heart_rate", "increased_acuity", 1.8))
        if rr is not None and (rr > 28 or rr < 9):
            reasons.append(("respiratory_rate", "increased_acuity", 1.8))
        if temp is not None and (temp >= 40 or temp <= 34):
            reasons.append(("temperature", "increased_acuity", 1.0))
        if pain is not None and pain >= 8:
            reasons.append(("pain_level", "increased_acuity", 0.7))
        if any(t in cc for t in self._RED_FLAGS):
            reasons.append(("chief_complaint", "increased_acuity", 4.0))
        elif any(t in cc for t in self._EMERGENT):
            reasons.append(("chief_complaint", "increased_acuity", 2.4))
        elif any(t in cc for t in self._MINOR):
            reasons.append(("chief_complaint", "decreased_acuity", 2.0))
        if spo2 is not None and spo2 >= 97 and (sbp is None or sbp >= 110):
            reasons.append(("oxygen_saturation", "decreased_acuity", 0.6))
        return reasons

    def _score(self, f: Mapping[str, Any]) -> float:
        s = 0.0
        for _feat, impact, w in self._reasons(f):
            s += w if impact == "increased_acuity" else -w
        return s

    @staticmethod
    def _score_to_esi(score: float) -> int:
        if score >= 6.0:
            return 1
        if score >= 3.0:
            return 2
        if score >= 0.5:
            return 3
        if score >= -1.5:
            return 4
        return 5

    def predict_proba(self, features: Mapping[str, Any]) -> dict[int, float]:
        esi = self._score_to_esi(self._score(features))
        # Indicative weights: mass on the rule output, decaying to neighbours.
        weights = {c: 0.06 for c in ESI_CLASSES}
        weights[esi] = 0.60
        for nb in (esi - 1, esi + 1):
            if nb in weights:
                weights[nb] = 0.15
        total = sum(weights.values())
        return {c: w / total for c, w in weights.items()}

    def explain(self, features: Mapping[str, Any], *, predicted_esi: int | None = None) -> dict:
        reasons = self._reasons(features)
        total = sum(w for _, _, w in reasons) or 1.0
        seen: dict[str, dict] = {}
        for feat, impact, w in sorted(reasons, key=lambda r: r[2], reverse=True):
            if feat in seen:
                continue
            seen[feat] = {
                "feature": feat,
                "label": feat.replace("_", " ").title(),
                "impact": impact,
                "importance": round(w / total, 4),
            }
        return {
            "method": "heuristic",
            "top_features": list(seen.values())[:5],
            "disclaimer": (
                "Rule-based estimate from vital-sign thresholds and chief-complaint "
                "keywords. Not a machine-learning model and not a clinical assessment."
            ),
        }


def build_predictor(
    *,
    enabled: bool,
    backend: str = "auto",
    model_path: str | None = None,
) -> TriagePredictor | None:
    """Return the predictor for the current configuration, or ``None`` if ML is
    disabled.

    ``backend``:
      * ``heuristic`` - always the rule-based predictor,
      * ``model`` - the artifact, raising :class:`ModelUnavailableError` if absent,
      * ``auto`` - the artifact if loadable, else the rule-based predictor.
    """
    if not enabled:
        logger.info("Triage ML disabled by configuration")
        return None

    if backend == "heuristic":
        return HeuristicTriagePredictor()

    path = resolve_model_path(model_path)

    if backend == "model":
        if not path:
            raise ModelUnavailableError(
                "TRIAGE_MODEL_BACKEND=model but no model artifact was found "
                "(set TRIAGE_MODEL_PATH or run ml.training.train)."
            )
        return ModelTriagePredictor(load_model(path))

    # auto
    if path:
        try:
            return ModelTriagePredictor(load_model(path))
        except ModelUnavailableError as exc:
            logger.warning("Model load failed (%s); using rule-based fallback", exc)
    else:
        logger.info("No model artifact found; using rule-based fallback predictor")
    return HeuristicTriagePredictor()
