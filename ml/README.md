# CareConnect - Triage ESI Prediction (ML)

Clinical **decision support** for emergency triage: given the initial
assessment, a model suggests an Emergency Severity Index (ESI) acuity of 1-5.
A clinician always reviews and can override it. The prediction is never a
diagnosis and never sets the final triage level on its own.

```
Next.js  ──►  FastAPI  ──►  app/ml/service.py  ──►  ml.inference.TriagePredictor
 (/triage)   (/api/emergency/     (load once,           │
              triage/*)            feature flag,        ├─ ModelTriagePredictor ─► sklearn/XGBoost pipeline
                                   graceful degrade)    └─ HeuristicTriagePredictor (rule-based fallback)
                                        │
                                   triage_predictions   (model prediction + human final ESI, side by side)
```

---

## 1. Objective

Predict **ESI acuity (1-5)** at the initial emergency triage assessment, as a
triage-prioritisation aid. Not diagnostic. Output is always framed as
"Model predicts ESI *n* - final triage requires human review."

## 2. Dataset

- **Training target dataset:** MIMIC-IV-ED (`edstays`, `triage`). Credentialed;
  **never committed** - see [`data/README.md`](data/README.md).
- **Shipped model (`triage_model_v1`)** is trained on a **synthetic** dataset
  (`ml/data/synthetic.py`) with the same schema, so the API works end to end
  without MIMIC access. Synthetic data is **not clinically valid**.

## 3. Features

Demographics (`age`, `sex`), arrival (`arrival_transport`), vitals
(`heart_rate`, `respiratory_rate`, `systolic_bp`, `diastolic_bp`,
`oxygen_saturation`, `temperature`), `pain_level`, and free-text
`chief_complaint` (TF-IDF). Derived: `shock_index`, `pulse_pressure`.
Full table and rationale: [`features.md`](features.md).

## 4. Target

`esi ∈ {1,2,3,4,5}`, multiclass. Classes are **not** collapsed. ESI 1-2
("high acuity") is reported separately during evaluation.

## 5. Leakage prevention

No diagnosis, disposition, ICU admission, mortality, length of stay, post-triage
medications, later vitals/labs/notes - nothing recorded after the triage
decision. Preprocessing (imputation, scaling, encoding, TF-IDF) is fit **only on
the training split** and is baked into the artifact. See [`features.md`](features.md).

## 6. Training process

`load → clean → stratified 60/20/20 split → fit preprocessing on train only →
train model zoo (× {structured, structured+TF-IDF}) → select on validation
macro-F1 (high-acuity-recall tie-break) → refit winner on train+val → evaluate
on the held-out test split → serialize pipeline + metadata`.

Offline only. Nothing dataset-specific runs in the API.

## 7. Models evaluated

Logistic Regression, Decision Tree, Random Forest, XGBoost - each with explicit
class weighting for the imbalanced ESI distribution. Selection uses macro-F1,
**not** accuracy.

## 8. NLP component

TF-IDF (1-2 grams, sublinear TF) over `chief_complaint`. The training run
compares **structured-only** vs **structured + TF-IDF** for the winning family
and records the result in the artifact metadata (`nlp_comparison`). The text
representation is a single pipeline step - swappable without touching the API or
UI.

## 9. Metrics (shipped `triage_model_v1`, synthetic test split, n=3200)

| Metric | Value |
|---|---|
| Accuracy | 0.782 |
| Macro precision / recall / F1 | 0.781 / 0.718 / 0.720 |
| Weighted F1 | 0.754 |
| **ESI 1-2 recall** | **0.833** |
| **ESI 1-2 precision** | **0.916** |
| **ESI 1-2 F1** | **0.872** |

Per-class F1: ESI 1 = 0.81, ESI 2 = 0.74, ESI 3 = 0.84, ESI 4 = 0.32,
ESI 5 = 0.89.

**Structured-only vs +TF-IDF (XGBoost, validation macro-F1):** 0.546 → 0.722.
Text clearly helps on this dataset.

Machine-readable: `ml/models/triage_model_v1.metrics.json` and
`...metadata.json` (kept in git as a record; the `.joblib` is regenerable and
gitignored).

> These numbers describe a model trained on **synthetic** data. They demonstrate
> the pipeline; they say nothing about real triage performance.

## 10. Model artifact format

`joblib.dump({"pipeline": <sklearn Pipeline>, "metadata": {...}}, path)`.

The pipeline is the **whole** inference path: `FeatureEngineer → ColumnTransformer
(impute/scale/one-hot/TF-IDF) → estimator`. Metadata carries `model_name`,
`model_version`, `training_dataset`, `target`, `features`, `training_date`,
`random_seed`, split sizes, `python_version`, `library_versions`, `metrics`,
`nlp_comparison`, `model_comparison`, and a `disclaimer`.

Versioned as `triage_model_v1`, `triage_model_v2`, ... Training refuses to
overwrite an existing version without `--force`. `models/latest.json` points the
loader at the current version.

## 11. Inference API

```
GET   /api/emergency/triage/health     - subsystem status (enabled, model, type)
POST  /api/emergency/triage/predict    - stateless prediction (no DB write)
POST  /api/emergency/triage            - predict + persist (+ optional final ESI)
GET   /api/emergency/triage            - caller's saved predictions
GET   /api/emergency/triage/{id}       - one saved prediction
PATCH /api/emergency/triage/{id}       - record the human override
```

Request (`/predict`):

```json
{
  "age": 58, "sex": "M", "arrival_transport": "ambulance",
  "heart_rate": 116, "respiratory_rate": 24, "systolic_bp": 100,
  "diastolic_bp": 66, "oxygen_saturation": 91, "temperature": 37.6,
  "pain_level": 7, "chief_complaint": "central chest pain"
}
```

Response:

```json
{
  "prediction": { "esi": 2, "label": "High Acuity", "esi_name": "Emergent" },
  "probabilities": { "1": 0.08, "2": 0.67, "3": 0.21, "4": 0.03, "5": 0.01 },
  "confidence": 0.67,
  "explanation": { "method": "shap", "top_features": [ ... ], "disclaimer": "..." },
  "model": { "name": "xgboost", "version": "v1", "type": "ml", "uses_text": true },
  "requires_human_review": true,
  "clinical_notice": "This prediction is generated by a machine-learning model ..."
}
```

**Validation:** `age` 0-120; each vital within a physiological range
(`ml.config.FEATURE_RANGES`); categorical values normalised to known
vocabularies; unknown request fields rejected; **≥ 3 of 6 core vitals required**.
Range/shape violations return `422` (standard FastAPI/pydantic body errors).

**Model loading:** loaded once at FastAPI startup (lifespan) and held in memory.
A missing/corrupt artifact never crashes the app - the endpoints return a
controlled `503` and manual triage continues.

**Feature flag / config** (`backend/app/config.py`, from environment):

| Var | Default | Meaning |
|---|---|---|
| `TRIAGE_ML_ENABLED` | `true` | Master switch. `false` → endpoints return 503, rest of app unaffected. |
| `TRIAGE_MODEL_BACKEND` | `auto` | `auto` (artifact else rule-based), `model` (require artifact), `heuristic` (always rule-based). |
| `TRIAGE_MODEL_PATH` | *(empty)* | Explicit `.joblib`; empty → `models/latest.json` → newest `triage_model_*.joblib`. |
| `TRIAGE_MODEL_VERSION` | *(empty)* | Informational only. |

## 12. SHAP explanation

`ml/explainability/shap_explainer.py`: TreeExplainer (LinearExplainer fallback)
on the transformed row for the predicted class. One-hot and TF-IDF columns are
folded back to their base feature; the top ~5 are returned as
`{feature, label, impact, importance}` where `impact ∈ {increased_acuity,
decreased_acuity, neutral}` (interpreted against the ordinal ESI scale). It
describes **model behaviour, not clinical truth**, and any failure returns an
empty `method:"none"` explanation - explanations never break a prediction.

The rule-based fallback emits an equivalent structure (`method:"heuristic"`)
listing the thresholds that fired.

## 13. Frontend integration

`frontend/src/app/triage/page.tsx` (nav: **Triage support**). An assessment
form → **Predict triage** → a visually distinct **MODEL PREDICTION** card (ESI,
band, confidence, per-level probabilities, "Why?" drivers, "⚠ Human review
required") with **Accept** / **Override**. Recording a decision shows a separate
**FINAL CLINICAL TRIAGE** panel. The model card never looks like an
authoritative clinical decision. API helpers: `frontend/src/lib/triage.ts`.

## 14. Human override

`triage_predictions` stores the model output and the human decision side by
side; model columns are never overwritten.

| Column | Meaning |
|---|---|
| `predicted_esi`, `prediction_probabilities`, `confidence`, `explanation` | model output (immutable) |
| `model_name`, `model_version`, `model_type` | which model produced it |
| `input_features` | inputs the prediction was made from (audit / reproducibility) |
| `human_final_esi` | clinician's decision |
| `was_overridden` | `human_final_esi != predicted_esi` |
| `override_reason`, `reviewed_by` | rationale + who |

`POST /api/emergency/triage` can record the final ESI in the same call (Accept);
`PATCH /api/emergency/triage/{id}` records it afterwards.

## 15. Limitations

- **`triage_model_v1` is trained on synthetic data** - a pipeline/integration
  demo, not a validated clinical tool. Do not deploy for real triage.
- Synthetic ESI 4 sits in a narrow band and is under-recalled (~0.21); a
  MIMIC-trained model would behave differently.
- No calibration of probabilities; `confidence` is the top class probability.
- No fairness / subgroup analysis. No temporal validation.
- The rule-based fallback is a coarse safety net, not a scoring system.
- Single triage snapshot only - no reassessment or trajectory.
- `age` is absent from MIMIC-IV-ED unless the `patients` table is also supplied.

## 16. How to retrain

```bash
pip install -r ml/requirements.txt

# Synthetic (regenerates the shipped demo model)
python -m ml.training.train --source synthetic --n-samples 16000 --model-version v1 --force

# Real data
python -m ml.training.train --source mimic --data-dir ml/data/mimic-iv-ed --model-version v2

# Evaluate a saved artifact
python -m ml.training.evaluate --model ml/models/triage_model_v2.joblib --source mimic --data-dir ml/data/mimic-iv-ed --out ml/models/triage_model_v2.metrics.json
```

Point the API at a new version with `TRIAGE_MODEL_VERSION` / `TRIAGE_MODEL_PATH`,
or let `models/latest.json` (written by training) select it. Restart the API to
reload.

## 17. How to replace the model

The API and UI depend only on `ml.inference.TriagePredictor` and the response
contract. To swap in e.g. LightGBM, or replace TF-IDF with embeddings:

1. Keep the `Pipeline(FeatureEngineer → transform → estimator)` shape, or
   implement a new `TriagePredictor` subclass in `ml/inference/predictor.py`.
2. Produce a `{"pipeline", "metadata"}` joblib artifact with the same metadata
   keys.
3. Bump `--model-version`. No FastAPI or frontend changes required.

## Layout

```
ml/
├── config.py                 feature names, ranges, ESI labels, clinical notice
├── data/                     synthetic.py, mimic.py  (datasets gitignored)
├── preprocessing/pipeline.py FeatureEngineer + ColumnTransformer + build_pipeline
├── training/                 config.py (zoo), train.py, evaluate.py
├── inference/                schemas.py, model_loader.py, predictor.py
├── explainability/           shap_explainer.py
├── models/                   *.joblib (gitignored), *.metrics.json / *.metadata.json
└── tests/                    preprocessing, predictor, evaluate, explainer
```

## Tests

```bash
pytest ml/tests backend/tests      # or just: pytest   (see pytest.ini)
```
