"""Pydantic v2 schemas for triage inference.

``TriageInput`` is the single validated feature contract - the FastAPI router
reuses it directly rather than redefining fields. Ranges come from
``ml.config.FEATURE_RANGES`` so validation and preprocessing agree.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from ml.config import (
    ARRIVAL_TRANSPORT_VALUES,
    CORE_VITALS,
    FEATURE_RANGES,
    MIN_VITALS_FOR_PREDICTION,
)

_AGE = FEATURE_RANGES["age"]
_HR = FEATURE_RANGES["heart_rate"]
_RR = FEATURE_RANGES["respiratory_rate"]
_SBP = FEATURE_RANGES["systolic_bp"]
_DBP = FEATURE_RANGES["diastolic_bp"]
_SPO2 = FEATURE_RANGES["oxygen_saturation"]
_TEMP = FEATURE_RANGES["temperature"]
_PAIN = FEATURE_RANGES["pain_level"]


class TriageInput(BaseModel):
    """Information available at the initial emergency triage assessment."""

    model_config = {"extra": "forbid"}

    age: int = Field(..., ge=_AGE[0], le=_AGE[1])
    sex: str = Field(..., description="M, F, OTHER or UNKNOWN")
    arrival_transport: str = Field(
        "unknown", description=f"one of {ARRIVAL_TRANSPORT_VALUES}"
    )
    chief_complaint: str = Field(..., min_length=1, max_length=500)

    heart_rate: float | None = Field(None, ge=_HR[0], le=_HR[1])
    respiratory_rate: float | None = Field(None, ge=_RR[0], le=_RR[1])
    systolic_bp: float | None = Field(None, ge=_SBP[0], le=_SBP[1])
    diastolic_bp: float | None = Field(None, ge=_DBP[0], le=_DBP[1])
    oxygen_saturation: float | None = Field(None, ge=_SPO2[0], le=_SPO2[1])
    temperature: float | None = Field(
        None, ge=_TEMP[0], le=_TEMP[1], description="degrees Celsius"
    )
    pain_level: int | None = Field(None, ge=_PAIN[0], le=_PAIN[1])

    @field_validator("sex", mode="before")
    @classmethod
    def _norm_sex(cls, v: object) -> str:
        s = str(v or "").strip().upper()
        if s in {"M", "MALE"}:
            return "M"
        if s in {"F", "FEMALE"}:
            return "F"
        if s in {"", "UNKNOWN", "U"}:
            return "UNKNOWN"
        return "OTHER"

    @field_validator("arrival_transport", mode="before")
    @classmethod
    def _norm_transport(cls, v: object) -> str:
        s = str(v or "unknown").strip().lower().replace(" ", "_")
        aliases = {
            "ambulance": "ambulance",
            "ems": "ambulance",
            "walk_in": "walk_in",
            "walkin": "walk_in",
            "self": "private",
            "car": "private",
            "public_transport": "public",
            "bus": "public",
            "helicopter": "helicopter",
            "air": "helicopter",
            "police": "police",
        }
        s = aliases.get(s, s)
        return s if s in ARRIVAL_TRANSPORT_VALUES else "other"

    @field_validator("chief_complaint", mode="before")
    @classmethod
    def _clean_text(cls, v: object) -> str:
        return str(v or "").strip()

    @model_validator(mode="after")
    def _require_min_vitals(self) -> "TriageInput":
        present = sum(
            1 for k in CORE_VITALS if getattr(self, k, None) is not None
        )
        if present < MIN_VITALS_FOR_PREDICTION:
            raise ValueError(
                f"At least {MIN_VITALS_FOR_PREDICTION} vital signs "
                f"({', '.join(CORE_VITALS)}) are required for a triage prediction."
            )
        return self

    def to_feature_dict(self) -> dict:
        return self.model_dump()


class FeatureContribution(BaseModel):
    feature: str
    impact: Literal["increased_acuity", "decreased_acuity", "neutral"]
    importance: float
    detail: str | None = None


class Prediction(BaseModel):
    esi: int = Field(..., ge=1, le=5)
    label: str
    esi_name: str


class Explanation(BaseModel):
    method: Literal["shap", "heuristic", "none"]
    top_features: list[FeatureContribution] = []
    disclaimer: str


class ModelInfo(BaseModel):
    name: str
    version: str
    type: Literal["ml", "heuristic"]
    uses_text: bool


class TriagePredictionResult(BaseModel):
    prediction: Prediction
    probabilities: dict[str, float]
    confidence: float
    explanation: Explanation
    model: ModelInfo
    requires_human_review: bool = True
    clinical_notice: str
