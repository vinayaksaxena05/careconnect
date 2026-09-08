"""Backend-side glue for the triage ML subsystem.

Thin wrapper around :mod:`ml.inference`: loads the predictor once at app
startup, enforces the feature flag, and degrades gracefully so an ML failure
never blocks an emergency workflow.
"""

from app.ml.service import TriageUnavailableError, triage_service

__all__ = ["triage_service", "TriageUnavailableError"]
