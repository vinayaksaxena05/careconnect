"""Process-wide triage predictor: load once, reuse for every request.

Design rules (see ml/README.md sections 21-24):

* the model is loaded a single time at FastAPI startup and held in memory,
* a missing/corrupt artifact never crashes the app - the endpoint returns a
  controlled 503 and manual triage continues,
* when ``TRIAGE_MODEL_BACKEND=model`` an unavailable artifact is logged loudly,
* raw patient data is never written to the application log.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

from app.config import (
    TRIAGE_ML_ENABLED,
    TRIAGE_MODEL_BACKEND,
    TRIAGE_MODEL_PATH,
    TRIAGE_MODEL_VERSION,
)

logger = logging.getLogger("careconnect.triage")

# The offline `ml` package lives at the repository root, one level above the
# backend working directory. Make it importable without packaging/installing.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


class TriageUnavailableError(RuntimeError):
    """ML prediction could not be produced. Carries an HTTP-ish status code."""

    def __init__(self, message: str, *, status_code: int = 503) -> None:
        super().__init__(message)
        self.status_code = status_code


class TriageService:
    """Holds the loaded predictor and mediates all access to it."""

    def __init__(self) -> None:
        self._predictor: Any | None = None
        self._status: str = "uninitialised"
        self._error: str | None = None

    # -- lifecycle -------------------------------------------------------- #

    def startup(self) -> None:
        if not TRIAGE_ML_ENABLED:
            self._status = "disabled"
            logger.info("Triage ML disabled (TRIAGE_ML_ENABLED is not truthy)")
            return
        try:
            from ml.inference import build_predictor

            self._predictor = build_predictor(
                enabled=True,
                backend=TRIAGE_MODEL_BACKEND,
                model_path=TRIAGE_MODEL_PATH or None,
            )
            self._status = "ready" if self._predictor is not None else "disabled"
            self._error = None
            if self._predictor is not None:
                logger.info(
                    "Triage predictor ready: %s %s (type=%s, uses_text=%s)",
                    self._predictor.name,
                    self._predictor.version,
                    self._predictor.kind,
                    self._predictor.uses_text,
                )
        except Exception as exc:  # noqa: BLE001 - never break app startup
            self._predictor = None
            self._status = "error"
            self._error = f"{type(exc).__name__}: {exc}"
            level = logging.ERROR if TRIAGE_MODEL_BACKEND == "model" else logging.WARNING
            logger.log(
                level,
                "Triage predictor failed to initialise (%s). "
                "/api/emergency/triage/* will return 503; manual triage unaffected.",
                self._error,
            )

    def shutdown(self) -> None:
        self._predictor = None
        self._status = "uninitialised"

    # -- introspection ------------------------------------------------------ #

    @property
    def status(self) -> str:
        return self._status

    def health(self) -> dict[str, Any]:
        info: dict[str, Any] = {
            "enabled": TRIAGE_ML_ENABLED,
            "status": self._status,
            "backend": TRIAGE_MODEL_BACKEND,
            "configured_version": TRIAGE_MODEL_VERSION or None,
        }
        if self._predictor is not None:
            info.update(
                model_name=self._predictor.name,
                model_version=self._predictor.version,
                model_type=self._predictor.kind,
                uses_text=self._predictor.uses_text,
            )
        if self._error:
            info["error"] = self._error
        return info

    # -- inference -------------------------------------------------------- #

    def _require_predictor(self) -> Any:
        if self._status == "disabled":
            raise TriageUnavailableError(
                "Triage prediction is disabled. Continue with standard manual triage.",
                status_code=503,
            )
        if self._predictor is None:
            raise TriageUnavailableError(
                "Triage prediction is temporarily unavailable. "
                "Continue with standard manual triage.",
                status_code=503,
            )
        return self._predictor

    def predict(self, features: dict[str, Any]) -> dict[str, Any]:
        """Return the full prediction payload for validated ``features``.

        ``features`` is expected to already be a validated ``TriageInput`` dump
        (range checks, min-vitals rule). Any downstream failure is converted to
        a :class:`TriageUnavailableError` - the caller must not 500.
        """
        predictor = self._require_predictor()
        try:
            return predictor.predict_result(features)
        except TriageUnavailableError:
            raise
        except Exception as exc:  # noqa: BLE001
            # Log the failure class only - never the patient payload.
            logger.error("Triage prediction failed: %s", type(exc).__name__)
            raise TriageUnavailableError(
                "Prediction unavailable. Continue with standard manual triage.",
                status_code=503,
            ) from exc


#: Import-time singleton; ``startup()`` is called from the FastAPI lifespan.
triage_service = TriageService()
