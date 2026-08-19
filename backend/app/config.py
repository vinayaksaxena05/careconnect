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
