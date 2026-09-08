"""Evaluation metric bundle."""

from __future__ import annotations

from ml.training.evaluate import evaluate_predictions, summary_line


def test_perfect_predictions():
    y = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5]
    m = evaluate_predictions(y, y)
    assert m["accuracy"] == 1.0
    assert m["macro_f1"] == 1.0
    assert m["high_acuity"]["recall"] == 1.0
    assert m["confusion_matrix"]["labels"] == [1, 2, 3, 4, 5]


def test_metric_bundle_has_required_keys():
    y_true = [1, 1, 2, 3, 3, 4, 5, 5, 2, 3]
    y_pred = [1, 2, 2, 3, 4, 4, 5, 4, 2, 3]
    m = evaluate_predictions(y_true, y_pred)
    for key in (
        "accuracy",
        "macro_precision",
        "macro_recall",
        "macro_f1",
        "weighted_f1",
        "per_class",
        "confusion_matrix",
        "high_acuity",
    ):
        assert key in m
    assert set(m["per_class"]) == {"1", "2", "3", "4", "5"}
    for band in ("precision", "recall", "f1"):
        assert band in m["high_acuity"]
    assert isinstance(summary_line(m), str)


def test_high_acuity_recall_counts_only_esi_1_and_2():
    # ESI 2 patient mislabelled as ESI 3 -> a missed high-acuity case.
    m = evaluate_predictions([2, 2, 4], [3, 2, 4])
    assert m["high_acuity"]["recall"] == 0.5
