"""Evaluation metrics for the multiclass ESI model.

Produces a machine-readable dict (see the module CLI to write it to JSON).
High-acuity (ESI 1-2) precision/recall/F1 are reported separately because
missing those patients matters far more than overall accuracy.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)

from ml.config import ESI_CLASSES, HIGH_ACUITY_CLASSES

logger = logging.getLogger("ml.training.evaluate")


def evaluate_predictions(
    y_true, y_pred, *, labels: list[int] | None = None
) -> dict[str, Any]:
    """Return the full metric bundle for one model's predictions."""
    labels = labels or ESI_CLASSES
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)

    per_p, per_r, per_f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=labels, zero_division=0
    )
    macro_p, macro_r, macro_f1, _ = precision_recall_fscore_support(
        y_true, y_pred, labels=labels, average="macro", zero_division=0
    )

    # High acuity as a one-vs-rest binary problem.
    hi_true = np.isin(y_true, HIGH_ACUITY_CLASSES)
    hi_pred = np.isin(y_pred, HIGH_ACUITY_CLASSES)
    hi_p, hi_r, hi_f1, _ = precision_recall_fscore_support(
        hi_true, hi_pred, average="binary", zero_division=0
    )

    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "macro_precision": float(macro_p),
        "macro_recall": float(macro_r),
        "macro_f1": float(macro_f1),
        "weighted_f1": float(
            f1_score(y_true, y_pred, labels=labels, average="weighted", zero_division=0)
        ),
        "per_class": {
            str(lbl): {
                "precision": float(per_p[i]),
                "recall": float(per_r[i]),
                "f1": float(per_f1[i]),
                "support": int(support[i]),
            }
            for i, lbl in enumerate(labels)
        },
        "confusion_matrix": {
            "labels": labels,
            "matrix": confusion_matrix(y_true, y_pred, labels=labels).tolist(),
        },
        "high_acuity": {
            "classes": HIGH_ACUITY_CLASSES,
            "precision": float(hi_p),
            "recall": float(hi_r),
            "f1": float(hi_f1),
        },
        "n": int(len(y_true)),
    }


def summary_line(metrics: dict[str, Any]) -> str:
    return (
        f"acc={metrics['accuracy']:.3f} "
        f"macroF1={metrics['macro_f1']:.3f} "
        f"weightedF1={metrics['weighted_f1']:.3f} "
        f"ESI1-2 recall={metrics['high_acuity']['recall']:.3f} "
        f"precision={metrics['high_acuity']['precision']:.3f}"
    )


def write_metrics(metrics: dict[str, Any], path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return path


def _cli() -> None:
    import joblib
    import pandas as pd

    parser = argparse.ArgumentParser(description="Evaluate a saved triage model")
    parser.add_argument("--model", required=True, help="path to a .joblib artifact")
    parser.add_argument("--source", choices=["synthetic", "mimic"], default="synthetic")
    parser.add_argument("--data-dir", default=None)
    parser.add_argument("--n-samples", type=int, default=12000)
    parser.add_argument("--out", default=None, help="write metrics JSON here")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    blob = joblib.load(args.model)
    pipeline = blob["pipeline"] if isinstance(blob, dict) else blob

    if args.source == "synthetic":
        from ml.data.synthetic import generate_synthetic_dataset

        df = generate_synthetic_dataset(args.n_samples)
    else:
        from ml.data.mimic import load_mimic_ed_dataset

        df = load_mimic_ed_dataset(args.data_dir)

    y = df["esi"].to_numpy()
    x = df.drop(columns=["esi"])
    pred = pipeline.predict(x)
    # Pipelines trained here predict 0-indexed classes; map back to ESI.
    pred_esi = pred + 1 if set(np.unique(pred)) <= {0, 1, 2, 3, 4} else pred
    metrics = evaluate_predictions(y, pred_esi)
    print(json.dumps(metrics, indent=2))
    print(summary_line(metrics))
    if args.out:
        write_metrics(metrics, args.out)


if __name__ == "__main__":
    _cli()
