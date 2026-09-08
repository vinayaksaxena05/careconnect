"""Offline training and evaluation.

Nothing here is imported by the production API. Run as modules:

    python -m ml.training.train --source synthetic --model-version v1
    python -m ml.training.evaluate --model ml/models/triage_model_v1.joblib \
        --source synthetic
"""
