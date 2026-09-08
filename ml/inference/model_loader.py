"""Locate and load a serialized triage pipeline.

Failures raise :class:`ModelUnavailableError` with a clear message - the caller
(the backend service) decides whether that is fatal (``TRIAGE_MODEL_BACKEND=
model``) or a cue to fall back to the rule-based predictor (``auto``).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ml.config import MODELS_DIR

logger = logging.getLogger("ml.inference.model_loader")


class ModelUnavailableError(RuntimeError):
    """Raised when no usable model artifact can be loaded."""


@dataclass(frozen=True)
class LoadedModel:
    pipeline: Any
    metadata: dict
    source_path: Path


def resolve_model_path(explicit: str | Path | None) -> Path | None:
    """Return the artifact to load, or ``None`` if there is nothing to load.

    Priority: explicit path -> ``models/latest.json`` pointer -> newest
    ``triage_model_*.joblib`` in the models directory.
    """
    if explicit:
        p = Path(explicit)
        return p if p.exists() else None

    latest = MODELS_DIR / "latest.json"
    if latest.exists():
        try:
            name = json.loads(latest.read_text(encoding="utf-8")).get("artifact")
            if name and (MODELS_DIR / name).exists():
                return MODELS_DIR / name
        except (ValueError, OSError):
            logger.warning("Could not read %s; falling back to glob", latest)

    candidates = sorted(MODELS_DIR.glob("triage_model_*.joblib"))
    return candidates[-1] if candidates else None


def load_model(path: str | Path) -> LoadedModel:
    path = Path(path)
    if not path.exists():
        raise ModelUnavailableError(f"Model artifact not found: {path}")

    try:
        import joblib

        blob = joblib.load(path)
    except Exception as exc:  # noqa: BLE001 - surface any load failure uniformly
        raise ModelUnavailableError(f"Failed to load {path}: {exc}") from exc

    if isinstance(blob, dict) and "pipeline" in blob:
        pipeline, metadata = blob["pipeline"], blob.get("metadata", {})
    else:
        # Tolerate a bare pipeline, but a well-formed artifact carries metadata.
        pipeline, metadata = blob, {}

    if not hasattr(pipeline, "predict") or not hasattr(pipeline, "predict_proba"):
        raise ModelUnavailableError(
            f"Artifact at {path} is not a probability-capable estimator"
        )

    logger.info(
        "Loaded triage model '%s' %s from %s",
        metadata.get("model_name", "unknown"),
        metadata.get("model_version", "?"),
        path,
    )
    return LoadedModel(pipeline=pipeline, metadata=metadata, source_path=path)
