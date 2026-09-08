#!/usr/bin/env bash
# Run the CareConnect backend (FastAPI) and frontend (Next.js) together.
#
#   ./dev.sh                 start both (Ctrl+C stops both)
#   ./dev.sh --install       pip install + npm install first, then start
#
# Ports:  BACKEND_PORT (default 5000), FRONTEND_PORT (default 3000)
#   BACKEND_PORT=8000 ./dev.sh
#
# The backend uses backend/.venv if present, otherwise 'python -m uvicorn'.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
BACKEND_PORT="${BACKEND_PORT:-5000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

[ -d "$BACKEND" ]  || { echo "missing: $BACKEND"  >&2; exit 1; }
[ -d "$FRONTEND" ] || { echo "missing: $FRONTEND" >&2; exit 1; }

# locate the backend uvicorn (venv first: Windows layout, then POSIX layout)
if   [ -x "$BACKEND/.venv/Scripts/uvicorn.exe" ]; then UVICORN=("$BACKEND/.venv/Scripts/uvicorn.exe")
elif [ -x "$BACKEND/.venv/bin/uvicorn" ];         then UVICORN=("$BACKEND/.venv/bin/uvicorn")
else UVICORN=(python -m uvicorn); echo "note: backend/.venv not found - using 'python -m uvicorn'" >&2
fi

if [ "${1:-}" = "--install" ]; then
  if   [ -x "$BACKEND/.venv/Scripts/python.exe" ]; then PY="$BACKEND/.venv/Scripts/python.exe"
  elif [ -x "$BACKEND/.venv/bin/python" ];         then PY="$BACKEND/.venv/bin/python"
  else PY=python
  fi
  echo "==> Installing backend dependencies"
  "$PY" -m pip install -r "$BACKEND/requirements.txt"
  echo "==> Installing frontend dependencies"
  ( cd "$FRONTEND" && npm install )
fi

pids=()
cleanup() {
  echo
  echo "stopping..."
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

( cd "$BACKEND" && PORT="$BACKEND_PORT" "${UVICORN[@]}" app.main:app --reload --port "$BACKEND_PORT" ) &
pids+=($!)
echo "backend  -> http://localhost:$BACKEND_PORT  (docs: /docs)"

( cd "$FRONTEND" && npm run dev -- --port "$FRONTEND_PORT" ) &
pids+=($!)
echo "frontend -> http://localhost:$FRONTEND_PORT"

wait
