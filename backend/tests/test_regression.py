"""Guard: the ML integration must not disturb existing CareConnect surface."""

from __future__ import annotations

import pytest


@pytest.fixture
def openapi_paths(client):
    return set(client.get("/openapi.json").json()["paths"])


def test_existing_routes_still_registered(openapi_paths):
    for path in (
        "/api/health",
        "/api/providers",
        "/api/services",
        "/api/me/profile",
        "/api/requests",
        "/api/emergency",
        "/api/me/medical-records",
        "/api/payments",
        "/api/analytics/summary",
        "/api/admin/stats",
    ):
        assert path in openapi_paths, f"missing pre-existing route {path}"


def test_triage_routes_added(openapi_paths):
    assert "/api/emergency/triage/predict" in openapi_paths
    assert "/api/emergency/triage/{prediction_id}" in openapi_paths
    assert "/api/emergency/triage" in openapi_paths


def test_health_endpoint_unaffected(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "service": "CareConnect API"}


def test_admin_tables_constant_includes_triage():
    from app.constants import ADMIN_TABLES

    assert "triage_predictions" in ADMIN_TABLES
    editable = set(ADMIN_TABLES["triage_predictions"]["editable"])
    assert not editable & {"predicted_esi", "prediction_probabilities", "model_name"}
