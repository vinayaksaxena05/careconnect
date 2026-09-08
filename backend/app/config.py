import os
import sys

from dotenv import load_dotenv

load_dotenv()

PORT = int(os.getenv("PORT", "5000"))
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_KEY",
        file=sys.stderr,
    )
    sys.exit(1)

TWO_HOURS_MS = 2 * 60 * 60 * 1000


def _env_flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


# --------------------------------------------------------------------------- #
# Triage ML (emergency ESI decision support). See ml/README.md.
# --------------------------------------------------------------------------- #

#: Master switch. When false the /api/emergency/triage/* endpoints return a
#: controlled 503 and the rest of CareConnect is unaffected.
TRIAGE_ML_ENABLED = _env_flag("TRIAGE_ML_ENABLED", "true")

#: "auto"  - load the model artifact if present, else the rule-based fallback
#: "model" - require the artifact (fail loudly if missing)
#: "heuristic" - always use the rule-based fallback
TRIAGE_MODEL_BACKEND = os.getenv("TRIAGE_MODEL_BACKEND", "auto").strip().lower()

#: Explicit path to a .joblib artifact. Empty -> ml/models/latest.json, then
#: the newest ml/models/triage_model_*.joblib.
TRIAGE_MODEL_PATH = os.getenv("TRIAGE_MODEL_PATH", "").strip()

#: Informational; the loaded artifact's own metadata is authoritative.
TRIAGE_MODEL_VERSION = os.getenv("TRIAGE_MODEL_VERSION", "").strip()
