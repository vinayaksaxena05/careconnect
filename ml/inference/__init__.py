"""Runtime inference - the only part of ``ml`` the backend imports.

    from ml.inference import build_predictor, TriageInput

The predictor abstraction hides scikit-learn / XGBoost entirely; swapping the
model (or falling back to the rule-based predictor) never changes the API or UI.
"""

from ml.inference.model_loader import ModelUnavailableError, load_model
from ml.inference.predictor import (
    HeuristicTriagePredictor,
    ModelTriagePredictor,
    TriagePredictor,
    build_predictor,
)
from ml.inference.schemas import TriageInput, TriagePredictionResult

__all__ = [
    "ModelUnavailableError",
    "load_model",
    "TriagePredictor",
    "ModelTriagePredictor",
    "HeuristicTriagePredictor",
    "build_predictor",
    "TriageInput",
    "TriagePredictionResult",
]
