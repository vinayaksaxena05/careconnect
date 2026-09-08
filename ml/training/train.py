"""Offline training entry point.

    python -m ml.training.train --source synthetic --model-version v1
    python -m ml.training.train --source mimic --data-dir /path/to/ed --model-version v1

Pipeline: load -> clean -> stratified 60/20/20 split -> fit preprocessing on
train only -> train the model zoo (optionally x {structured, structured+text})
-> select best on validation macro-F1 (high-acuity recall tie-break) -> refit
best on train+val -> evaluate on the held-out test split -> serialize the whole
pipeline + metadata. Never overwrites an existing version without --force.
"""

from __future__ import annotations

import argparse
import json
import logging
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.base import clone
from sklearn.model_selection import train_test_split

from ml.config import (
    ALL_INPUT_FEATURES,
    CATEGORICAL_FEATURES,
    DERIVED_NUMERIC_FEATURES,
    ESI_CLASSES,
    MODELS_DIR,
    NUMERIC_FEATURES,
    RANDOM_SEED,
    TARGET,
    TEXT_FEATURE,
)
from ml.preprocessing.pipeline import build_pipeline
from ml.training.config import TEST_SIZE, VAL_SIZE, build_model_zoo
from ml.training.evaluate import evaluate_predictions, summary_line

logger = logging.getLogger("ml.training.train")

ESI_OFFSET = 1  # model classes are 0-indexed: y = esi - ESI_OFFSET


def _load_dataframe(args: argparse.Namespace) -> tuple[pd.DataFrame, str]:
    if args.source == "synthetic":
        from ml.data.synthetic import generate_synthetic_dataset

        df = generate_synthetic_dataset(args.n_samples, seed=args.seed)
        return df, f"synthetic-{args.n_samples}"

    from ml.data.mimic import load_mimic_ed_dataset

    if not args.data_dir:
        sys.exit("--data-dir is required for --source mimic")
    return load_mimic_ed_dataset(args.data_dir), "MIMIC-IV-ED"


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in ALL_INPUT_FEATURES:
        if col not in df.columns:
            df[col] = "" if col == TEXT_FEATURE else np.nan
    df[TARGET] = pd.to_numeric(df[TARGET], errors="coerce")
    df = df[df[TARGET].isin(ESI_CLASSES)].copy()
    df[TARGET] = df[TARGET].astype(int)
    return df.reset_index(drop=True)


def _split(df: pd.DataFrame, seed: int):
    x = df[ALL_INPUT_FEATURES]
    y = df[TARGET].to_numpy()
    x_tmp, x_test, y_tmp, y_test = train_test_split(
        x, y, test_size=TEST_SIZE, stratify=y, random_state=seed
    )
    val_ratio = VAL_SIZE / (1.0 - TEST_SIZE)
    x_tr, x_val, y_tr, y_val = train_test_split(
        x_tmp, y_tmp, test_size=val_ratio, stratify=y_tmp, random_state=seed
    )
    return x_tr, x_val, x_test, y_tr, y_val, y_test


def _fit_eval(estimator, use_text, x_tr, y_tr, x_val, y_val) -> tuple[Any, dict]:
    pipe = build_pipeline(clone(estimator), use_text=use_text)
    pipe.fit(x_tr, y_tr - ESI_OFFSET)
    val_pred = pipe.predict(x_val) + ESI_OFFSET
    return pipe, evaluate_predictions(y_val, val_pred)


def _rank_key(metrics: dict) -> tuple[float, float]:
    return metrics["macro_f1"], metrics["high_acuity"]["recall"]


def train(args: argparse.Namespace) -> Path:
    df, dataset_label = _load_dataframe(args)
    df = _clean(df)
    logger.info("Dataset %s: %d rows, class balance %s", dataset_label, len(df),
                df[TARGET].value_counts().sort_index().to_dict())

    x_tr, x_val, x_test, y_tr, y_val, y_test = _split(df, args.seed)
    logger.info("Split sizes train=%d val=%d test=%d", len(x_tr), len(x_val), len(x_test))

    if args.text_mode == "compare":
        text_options = [False, True]
    elif args.text_mode == "on":
        text_options = [True]
    else:
        text_options = [False]

    zoo = build_model_zoo()
    logger.info("Model zoo: %s", ", ".join(zoo))

    val_results: dict[tuple[str, bool], dict] = {}
    fitted: dict[tuple[str, bool], Any] = {}
    for use_text in text_options:
        for name, estimator in zoo.items():
            pipe, metrics = _fit_eval(estimator, use_text, x_tr, y_tr, x_val, y_val)
            val_results[(name, use_text)] = metrics
            fitted[(name, use_text)] = pipe
            logger.info(
                "val  %-20s text=%-5s  %s", name, use_text, summary_line(metrics)
            )

    best_key = max(val_results, key=lambda k: _rank_key(val_results[k]))
    best_name, best_use_text = best_key
    logger.info("Selected: %s (text=%s) by macro_f1 / high-acuity recall",
                best_name, best_use_text)

    # Structured vs structured+text comparison, for the same winning family.
    nlp_comparison = None
    if args.text_mode == "compare" and (best_name, False) in val_results:
        nlp_comparison = {
            "model": best_name,
            "structured_only": val_results[(best_name, False)],
            "structured_plus_tfidf": val_results[(best_name, True)],
            "tfidf_helps": (
                _rank_key(val_results[(best_name, True)])
                > _rank_key(val_results[(best_name, False)])
            ),
        }

    # Refit the winner on train + val, then score the untouched test split.
    x_trv = pd.concat([x_tr, x_val], axis=0)
    y_trv = np.concatenate([y_tr, y_val])
    final_pipe = build_pipeline(clone(zoo[best_name]), use_text=best_use_text)
    final_pipe.fit(x_trv, y_trv - ESI_OFFSET)
    test_pred = final_pipe.predict(x_test) + ESI_OFFSET
    test_metrics = evaluate_predictions(y_test, test_pred)
    logger.info("TEST %-20s %s", best_name, summary_line(test_metrics))

    version = args.model_version
    stem = f"triage_model_{version}"
    artifact_path = Path(args.output_dir or MODELS_DIR) / f"{stem}.joblib"
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    if artifact_path.exists() and not args.force:
        sys.exit(
            f"{artifact_path} already exists. Bump --model-version or pass --force."
        )

    metadata = {
        "model_name": best_name,
        "model_version": version,
        "model_kind": "ml",
        "training_dataset": dataset_label,
        "dataset_is_synthetic": args.source == "synthetic",
        "target": TARGET,
        "esi_classes": ESI_CLASSES,
        "label_encoding": "model_class = esi - 1",
        "uses_text": best_use_text,
        "features": {
            "numeric": NUMERIC_FEATURES,
            "derived_numeric": DERIVED_NUMERIC_FEATURES,
            "categorical": CATEGORICAL_FEATURES,
            "text": TEXT_FEATURE if best_use_text else None,
        },
        "training_date": datetime.now(timezone.utc).isoformat(),
        "random_seed": args.seed,
        "n_train": int(len(x_tr)),
        "n_val": int(len(x_val)),
        "n_test": int(len(x_test)),
        "python_version": platform.python_version(),
        "library_versions": {
            "scikit-learn": sklearn.__version__,
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "xgboost": _xgb_version(),
        },
        "metrics": test_metrics,
        "validation_metrics": val_results.get(best_key),
        "nlp_comparison": nlp_comparison,
        "model_comparison": {
            f"{n}|text={t}": {
                "macro_f1": m["macro_f1"],
                "weighted_f1": m["weighted_f1"],
                "high_acuity_recall": m["high_acuity"]["recall"],
            }
            for (n, t), m in val_results.items()
        },
        "disclaimer": (
            "Synthetic training data - NOT clinically valid. For pipeline and "
            "integration demonstration only."
            if args.source == "synthetic"
            else "Trained on MIMIC-IV-ED. Research use only; not a medical device."
        ),
    }

    joblib.dump({"pipeline": final_pipe, "metadata": metadata}, artifact_path)
    (artifact_path.with_suffix(".metadata.json")).write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    (artifact_path.with_suffix(".metrics.json")).write_text(
        json.dumps(test_metrics, indent=2), encoding="utf-8"
    )
    (Path(artifact_path).parent / "latest.json").write_text(
        json.dumps({"version": version, "artifact": artifact_path.name}, indent=2),
        encoding="utf-8",
    )
    logger.info("Wrote %s", artifact_path)
    return artifact_path


def _xgb_version() -> str | None:
    try:
        import xgboost

        return xgboost.__version__
    except ImportError:  # pragma: no cover
        return None


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Train the CareConnect triage model")
    p.add_argument("--source", choices=["synthetic", "mimic"], default="synthetic")
    p.add_argument("--data-dir", default=None, help="MIMIC-IV-ED 'ed' folder")
    p.add_argument("--n-samples", type=int, default=12000, help="synthetic rows")
    p.add_argument("--model-version", default="v1")
    p.add_argument("--output-dir", default=None)
    p.add_argument(
        "--text-mode",
        choices=["compare", "on", "off"],
        default="compare",
        help="compare: evaluate structured vs structured+TF-IDF and pick best",
    )
    p.add_argument("--seed", type=int, default=RANDOM_SEED)
    p.add_argument("--force", action="store_true", help="overwrite existing version")
    return p


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    args = build_arg_parser().parse_args(argv)
    train(args)


if __name__ == "__main__":
    main()
