"""SHAP explanations, reduced to a handful of named drivers.

The output describes *model behaviour* ("oxygen saturation pushed the model
toward a higher-acuity level"), never clinical truth. One-hot and TF-IDF
columns are folded back to their source feature. Any failure returns an empty
``method="none"`` explanation - explanations must never break a prediction.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import numpy as np

from ml.config import HIGH_ACUITY_CLASSES, TEXT_FEATURE

logger = logging.getLogger("ml.explainability")

_PRETTY = {
    "age": "Age",
    "heart_rate": "Heart rate",
    "respiratory_rate": "Respiratory rate",
    "systolic_bp": "Systolic BP",
    "diastolic_bp": "Diastolic BP",
    "oxygen_saturation": "Oxygen saturation",
    "temperature": "Temperature",
    "pain_level": "Pain level",
    "shock_index": "Shock index (HR/SBP)",
    "pulse_pressure": "Pulse pressure",
    "sex": "Sex",
    "arrival_transport": "Arrival transport",
    TEXT_FEATURE: "Chief complaint",
}


def _base_feature(raw_name: str) -> str:
    """Map a transformed column name back to its source feature.

    ColumnTransformer prefixes columns with the transformer name:
    ``numeric__heart_rate``, ``categorical__sex_M``, ``text__chest pain``.
    """
    if raw_name.startswith("text__"):
        return TEXT_FEATURE
    name = re.sub(r"^(numeric|categorical|remainder)__", "", raw_name)
    for base in _PRETTY:
        if name == base or name.startswith(f"{base}_"):
            return base
    return name


def _impact(signed_contribution: float, predicted_esi: int) -> str:
    """Translate a signed SHAP contribution for the predicted class into the
    direction of acuity, given ESI is ordinal (1 = most acute)."""
    if abs(signed_contribution) < 1e-9:
        return "neutral"
    pushes_toward_predicted = signed_contribution > 0
    predicted_is_high = predicted_esi in HIGH_ACUITY_CLASSES
    if predicted_is_high:
        return "increased_acuity" if pushes_toward_predicted else "decreased_acuity"
    # Predicted a lower-acuity level: supporting it means arguing against acuity.
    return "decreased_acuity" if pushes_toward_predicted else "increased_acuity"


def explain_model_prediction(
    pipeline: Any, x_row_df, predicted_esi: int, *, top_n: int = 5
) -> dict:
    """Return ``{"method", "top_features": [...], "disclaimer"}``."""
    disclaimer = (
        "Explains how the model weighted the inputs for this prediction. "
        "It is not a clinical assessment."
    )
    try:
        import shap  # noqa: F401

        pre = pipeline[:-1]
        model = pipeline[-1]
        x_trans = pre.transform(x_row_df)
        if hasattr(x_trans, "toarray"):
            x_trans = x_trans.toarray()
        x_trans = np.asarray(x_trans, dtype=float)

        try:
            feat_names = list(pipeline.named_steps["preprocess"].get_feature_names_out())
        except Exception:  # noqa: BLE001
            feat_names = [f"f{i}" for i in range(x_trans.shape[1])]

        class_idx = max(0, int(predicted_esi) - 1)
        contributions = _shap_contributions(model, x_trans, class_idx)
        if contributions is None:
            return {"method": "none", "top_features": [], "disclaimer": disclaimer}

        # Fold transformed columns back onto their base feature.
        folded: dict[str, float] = {}
        for name, val in zip(feat_names, contributions):
            folded[_base_feature(name)] = folded.get(_base_feature(name), 0.0) + float(val)

        ranked = sorted(folded.items(), key=lambda kv: abs(kv[1]), reverse=True)
        total = sum(abs(v) for _, v in ranked) or 1.0
        top = []
        for base, signed in ranked[:top_n]:
            if abs(signed) < 1e-6:
                continue
            top.append(
                {
                    "feature": base,
                    "label": _PRETTY.get(base, base.replace("_", " ").title()),
                    "impact": _impact(signed, predicted_esi),
                    "importance": round(abs(signed) / total, 4),
                }
            )
        return {"method": "shap", "top_features": top, "disclaimer": disclaimer}
    except Exception as exc:  # noqa: BLE001 - explanations are best-effort
        logger.warning("SHAP explanation failed (%s); returning none", exc.__class__.__name__)
        return {"method": "none", "top_features": [], "disclaimer": disclaimer}


def _shap_contributions(model, x_trans, class_idx: int):
    """Per-feature SHAP values for one row and one class, or ``None``."""
    import shap

    try:
        explainer = shap.TreeExplainer(model)
        values = explainer.shap_values(x_trans)
    except Exception:  # noqa: BLE001 - not a tree model (e.g. logistic regression)
        try:
            explainer = shap.LinearExplainer(model, x_trans)
            values = explainer.shap_values(x_trans)
        except Exception:  # noqa: BLE001
            return None

    arr = np.asarray(values)
    # Shapes seen across shap versions:
    #   (n_classes, n_samples, n_features) | (n_samples, n_features, n_classes)
    #   | (n_samples, n_features) for binary/linear
    if arr.ndim == 3:
        if arr.shape[0] <= 5 and arr.shape[0] != x_trans.shape[0]:
            row = arr[min(class_idx, arr.shape[0] - 1), 0, :]
        else:
            row = arr[0, :, min(class_idx, arr.shape[2] - 1)]
    elif arr.ndim == 2:
        row = arr[0, :]
    else:
        return None
    return np.asarray(row, dtype=float)
