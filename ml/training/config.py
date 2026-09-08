"""Model zoo and hyperparameters for the baseline comparison.

Four families, each with sensible fixed hyperparameters and explicit class
handling (imbalanced ESI distribution - ESI 1 is rare). We do not tune for
overall accuracy; selection uses macro-F1 with a high-acuity-recall tie-break
(see train.py).
"""

from __future__ import annotations

from typing import Any

from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier

from ml.config import ESI_CLASSES, RANDOM_SEED

#: Selection metric on the validation split; tie-break listed second.
SELECTION_METRIC = "macro_f1"
SELECTION_TIEBREAK = "high_acuity_recall"

#: 60 / 20 / 20 stratified train / val / test.
VAL_SIZE = 0.20
TEST_SIZE = 0.20


def build_model_zoo() -> dict[str, Any]:
    """Fresh, unfitted estimators keyed by name.

    XGBoost is imported lazily so the module still loads if the optional
    dependency is absent (the other three then form the comparison).
    """
    zoo: dict[str, Any] = {
        "logistic_regression": LogisticRegression(
            max_iter=2000,
            class_weight="balanced",
            n_jobs=None,
        ),
        "decision_tree": DecisionTreeClassifier(
            max_depth=10,
            min_samples_leaf=20,
            class_weight="balanced",
            random_state=RANDOM_SEED,
        ),
        "random_forest": RandomForestClassifier(
            n_estimators=300,
            max_depth=None,
            min_samples_leaf=5,
            class_weight="balanced_subsample",
            n_jobs=-1,
            random_state=RANDOM_SEED,
        ),
    }

    try:
        from xgboost import XGBClassifier
    except ImportError:  # pragma: no cover - optional dependency
        return zoo

    zoo["xgboost"] = XGBClassifier(
        n_estimators=400,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="multi:softprob",
        num_class=len(ESI_CLASSES),
        tree_method="hist",
        eval_metric="mlogloss",
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )
    return zoo
