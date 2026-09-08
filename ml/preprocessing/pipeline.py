"""Preprocessing as a single fitted scikit-learn pipeline.

The serialized model artifact is the whole pipeline - feature engineering,
imputation, scaling, encoding and TF-IDF - so inference cannot diverge from
training. Everything stateful (medians, category lists, IDF weights) is fit
**only on the training split**; callers must never fit on pooled data.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from ml.config import (
    ARRIVAL_TRANSPORT_VALUES,
    CATEGORICAL_FEATURES,
    FEATURE_RANGES,
    MODEL_NUMERIC_FEATURES,
    SEX_VALUES,
    TEXT_FEATURE,
)


class FeatureEngineer(BaseEstimator, TransformerMixin):
    """Stateless, deterministic cleaning + derived features.

    Runs first in the pipeline, identically at fit and predict time:

    * numeric inputs are coerced and clipped to physiological ranges
      (out-of-range -> NaN, left for the imputer),
    * ``shock_index`` (HR / SBP) and ``pulse_pressure`` (SBP - DBP) are added,
    * categoricals are normalised to their known vocabularies,
    * the chief-complaint text is lower-cased.
    """

    def fit(self, X, y=None):  # noqa: N803 - sklearn signature
        return self

    def transform(self, X):  # noqa: N803 - sklearn signature
        df = pd.DataFrame(X).copy()

        for col, (lo, hi) in FEATURE_RANGES.items():
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").clip(lo, hi)

        hr = df["heart_rate"] if "heart_rate" in df.columns else None
        sbp = df["systolic_bp"] if "systolic_bp" in df.columns else None
        dbp = df["diastolic_bp"] if "diastolic_bp" in df.columns else None

        if hr is not None and sbp is not None:
            safe_sbp = sbp.replace(0, np.nan)
            df["shock_index"] = (hr / safe_sbp).replace([np.inf, -np.inf], np.nan)
        else:
            df["shock_index"] = np.nan

        if sbp is not None and dbp is not None:
            df["pulse_pressure"] = sbp - dbp
        else:
            df["pulse_pressure"] = np.nan

        if "sex" in df.columns:
            sex = df["sex"].astype("string").str.upper().str.strip()
            sex = sex.where(sex.isin(SEX_VALUES), other="UNKNOWN")
            df["sex"] = sex.fillna("UNKNOWN")

        if "arrival_transport" in df.columns:
            at = df["arrival_transport"].astype("string").str.lower().str.strip()
            at = at.where(at.isin(ARRIVAL_TRANSPORT_VALUES), other="unknown")
            df["arrival_transport"] = at.fillna("unknown")

        if TEXT_FEATURE in df.columns:
            df[TEXT_FEATURE] = (
                df[TEXT_FEATURE].astype("string").fillna("").str.lower().str.strip()
            )

        # Guarantee every column the ColumnTransformer expects exists.
        for col in MODEL_NUMERIC_FEATURES + CATEGORICAL_FEATURES + [TEXT_FEATURE]:
            if col not in df.columns:
                df[col] = "" if col == TEXT_FEATURE else np.nan

        return df

    def get_feature_names_out(self, input_features=None):  # noqa: D102
        return np.asarray(
            MODEL_NUMERIC_FEATURES + CATEGORICAL_FEATURES + [TEXT_FEATURE],
            dtype=object,
        )


def build_preprocessor(*, use_text: bool) -> ColumnTransformer:
    """Column-wise transform: numeric (median impute + scale), categorical
    (mode impute + one-hot) and, optionally, TF-IDF over the chief complaint.
    """
    numeric_pipe = Pipeline(
        steps=[
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
        ]
    )
    categorical_pipe = Pipeline(
        steps=[
            ("impute", SimpleImputer(strategy="most_frequent")),
            ("encode", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
        ]
    )

    transformers = [
        ("numeric", numeric_pipe, MODEL_NUMERIC_FEATURES),
        ("categorical", categorical_pipe, CATEGORICAL_FEATURES),
    ]
    if use_text:
        transformers.append(
            (
                "text",
                TfidfVectorizer(
                    max_features=400,
                    ngram_range=(1, 2),
                    min_df=2,
                    sublinear_tf=True,
                    stop_words="english",
                ),
                TEXT_FEATURE,
            )
        )

    return ColumnTransformer(
        transformers=transformers,
        remainder="drop",
        sparse_threshold=0.0,  # keep the matrix dense - simplifies SHAP
    )


def build_pipeline(estimator, *, use_text: bool) -> Pipeline:
    """Full inference pipeline: engineer -> preprocess -> estimator."""
    return Pipeline(
        steps=[
            ("engineer", FeatureEngineer()),
            ("preprocess", build_preprocessor(use_text=use_text)),
            ("model", estimator),
        ]
    )
