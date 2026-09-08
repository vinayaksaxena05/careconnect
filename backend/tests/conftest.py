"""Shared fixtures for the FastAPI backend tests.

`app.config` calls ``sys.exit`` when Supabase env vars are missing, so they are
set here *before* any app import. The real Supabase client is replaced with a
tiny in-memory fake that supports only the query chains the triage router uses.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("TRIAGE_ML_ENABLED", "true")
os.environ.setdefault("TRIAGE_MODEL_BACKEND", "heuristic")  # deterministic in CI


# --------------------------------------------------------------------------- #
# Minimal in-memory Supabase stand-in
# --------------------------------------------------------------------------- #


class _Query:
    def __init__(self, store: dict[str, list[dict]], table: str):
        self._store = store
        self._table = table
        self._filters: list[tuple[str, object]] = []
        self._op: str | None = None
        self._payload: object = None
        self._single = False

    # write ops -------------------------------------------------------------
    def insert(self, rows):
        self._op, self._payload = "insert", rows
        return self

    def update(self, patch):
        self._op, self._payload = "update", patch
        return self

    # read modifiers ------------------------------------------------------
    def select(self, *_a, **_k):
        if self._op is None:
            self._op = "select"
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def order(self, *_a, **_k):
        return self

    def maybe_single(self):
        self._single = True
        return self

    def single(self):
        self._single = True
        return self

    # execution ---------------------------------------------------------
    def _match(self, row) -> bool:
        return all(row.get(c) == v for c, v in self._filters)

    def execute(self):
        rows = self._store.setdefault(self._table, [])

        if self._op == "insert":
            created = []
            for raw in self._payload:
                row = dict(raw)
                row.setdefault("id", str(uuid.uuid4()))
                row.setdefault("created_at", datetime.now(timezone.utc).isoformat())
                row.setdefault("updated_at", row["created_at"])
                row.setdefault("was_overridden", row.get("was_overridden", False))
                row.setdefault("human_final_esi", row.get("human_final_esi"))
                rows.append(row)
                created.append(row)
            return SimpleNamespace(data=created, count=len(created))

        matched = [r for r in rows if self._match(r)]

        if self._op == "update":
            for r in matched:
                r.update(self._payload)
            return SimpleNamespace(data=matched, count=len(matched))

        # select
        if self._single:
            return SimpleNamespace(data=(matched[0] if matched else None), count=None)
        return SimpleNamespace(data=matched, count=len(matched))


class FakeSupabase:
    def __init__(self):
        self.store: dict[str, list[dict]] = {}

    def table(self, name: str) -> _Query:
        return _Query(self.store, name)


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #


@pytest.fixture
def fake_supabase(monkeypatch):
    fake = FakeSupabase()
    # Patch every module that imported the singleton by name.
    import app.db
    import app.routers.triage as triage_router

    monkeypatch.setattr(app.db, "supabase", fake)
    monkeypatch.setattr(triage_router, "supabase", fake)
    return fake


@pytest.fixture
def client(fake_supabase):
    from fastapi.testclient import TestClient

    from app.deps import AuthContext, require_auth
    from app.main import app

    user = SimpleNamespace(id="11111111-1111-1111-1111-111111111111", email="p@example.com")
    app.dependency_overrides[require_auth] = lambda: AuthContext(user=user)
    with TestClient(app) as c:
        c.user = user  # type: ignore[attr-defined]
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def valid_features():
    return {
        "age": 58,
        "sex": "M",
        "arrival_transport": "ambulance",
        "chief_complaint": "central chest pain",
        "heart_rate": 116,
        "respiratory_rate": 24,
        "systolic_bp": 100,
        "diastolic_bp": 66,
        "oxygen_saturation": 91,
        "temperature": 37.6,
        "pain_level": 7,
    }
