"""API contract for /api/emergency/triage/*."""

from __future__ import annotations


def test_health_reports_ready(client):
    body = client.get("/api/emergency/triage/health").json()
    assert body["enabled"] is True
    assert body["status"] == "ready"
    assert body["model_type"] in {"ml", "heuristic"}


def test_predict_returns_full_contract(client, valid_features):
    r = client.post("/api/emergency/triage/predict", json=valid_features)
    assert r.status_code == 200
    body = r.json()
    assert 1 <= body["prediction"]["esi"] <= 5
    assert body["prediction"]["label"]
    assert set(body["probabilities"]) == {"1", "2", "3", "4", "5"}
    assert abs(sum(body["probabilities"].values()) - 1.0) < 1e-6
    assert body["requires_human_review"] is True
    assert "clinical_notice" in body
    assert body["model"]["name"]


def test_predict_rejects_out_of_range_vital(client, valid_features):
    bad = {**valid_features, "heart_rate": 900}
    assert client.post("/api/emergency/triage/predict", json=bad).status_code == 422


def test_predict_rejects_too_few_vitals(client):
    thin = {
        "age": 40,
        "sex": "F",
        "arrival_transport": "walk_in",
        "chief_complaint": "sore throat",
    }
    assert client.post("/api/emergency/triage/predict", json=thin).status_code == 422


def test_predict_rejects_unknown_field(client, valid_features):
    bad = {**valid_features, "diagnosis": "MI"}  # leakage-style field
    assert client.post("/api/emergency/triage/predict", json=bad).status_code == 422


def test_create_persists_prediction(client, valid_features, fake_supabase):
    r = client.post("/api/emergency/triage", json={"features": valid_features})
    assert r.status_code == 201
    body = r.json()
    assert body["prediction"]["prediction"]["esi"] >= 1
    stored = fake_supabase.store["triage_predictions"]
    assert len(stored) == 1
    assert stored[0]["user_id"] == client.user.id
    assert stored[0]["predicted_esi"] == body["record"]["predicted_esi"]
    assert stored[0]["requires_human_review"] is True


def test_create_with_accept_records_matching_final(client, valid_features, fake_supabase):
    predicted = client.post(
        "/api/emergency/triage/predict", json=valid_features
    ).json()["prediction"]["esi"]
    r = client.post(
        "/api/emergency/triage",
        json={"features": valid_features, "human_final_esi": predicted},
    )
    row = fake_supabase.store["triage_predictions"][0]
    assert r.status_code == 201
    assert row["human_final_esi"] == predicted
    assert row["was_overridden"] is False


def test_override_preserves_model_prediction(client, valid_features, fake_supabase):
    created = client.post(
        "/api/emergency/triage", json={"features": valid_features}
    ).json()["record"]
    model_esi = created["predicted_esi"]
    other = 1 if model_esi != 1 else 2

    r = client.patch(
        f"/api/emergency/triage/{created['id']}",
        json={"human_final_esi": other, "override_reason": "clinical gestalt differs"},
    )
    assert r.status_code == 200
    row = fake_supabase.store["triage_predictions"][0]
    assert row["predicted_esi"] == model_esi  # untouched
    assert row["human_final_esi"] == other
    assert row["was_overridden"] is True
    assert row["override_reason"] == "clinical gestalt differs"


def test_override_unknown_id_is_404(client):
    r = client.patch(
        "/api/emergency/triage/does-not-exist", json={"human_final_esi": 3}
    )
    assert r.status_code == 404


def test_list_returns_only_caller_rows(client, valid_features, fake_supabase):
    client.post("/api/emergency/triage", json={"features": valid_features})
    fake_supabase.store["triage_predictions"].append(
        {"id": "x", "user_id": "someone-else", "predicted_esi": 4}
    )
    rows = client.get("/api/emergency/triage").json()
    assert [row["user_id"] for row in rows] == [client.user.id]


def test_predict_unavailable_when_disabled(client, monkeypatch, valid_features):
    from app.ml import triage_service

    monkeypatch.setattr(triage_service, "_status", "disabled")
    monkeypatch.setattr(triage_service, "_predictor", None)
    r = client.post("/api/emergency/triage/predict", json=valid_features)
    assert r.status_code == 503
    assert "manual triage" in r.json()["error"].lower()
