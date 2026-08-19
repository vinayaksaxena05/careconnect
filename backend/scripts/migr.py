"""
Apply SQL files from supabase/migrations in timestamp order.

Setup:
  1. In Supabase Dashboard → Project Settings → Database, copy the
     "URI" connection string (Direct connection or Session pooler).
  2. Add to backend/.env:
       DATABASE_URL=postgresql://postgres.[ref]:YOUR_PASSWORD@...

Usage:
  python -m scripts.migr
  python -m scripts.migr --from 20250404000000
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = BACKEND_DIR.parent / "supabase" / "migrations"

load_dotenv(BACKEND_DIR / ".env")


def file_timestamp(filename: str) -> str:
    m = re.match(r"^(\d{14})", filename)
    return m.group(1) if m else "00000000000000"


def ensure_migrations_table(conn: psycopg.Connection) -> None:
    conn.execute(
        """
        create table if not exists public.schema_migrations (
          filename text primary key,
          applied_at timestamptz not null default now()
        );
        """
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply Supabase SQL migrations")
    parser.add_argument(
        "--from",
        dest="from_ts",
        default=None,
        help="Skip migrations with timestamp strictly before this 14-digit value",
    )
    args = parser.parse_args()
    from_ts = None
    if args.from_ts:
        from_ts = re.sub(r"\D", "", args.from_ts)[:14]
        if len(from_ts) != 14:
            print(
                "--from expects a 14-digit migration timestamp, e.g. 20250404000000",
                file=sys.stderr,
            )
            sys.exit(1)

    url = os.getenv("DATABASE_URL")
    if not url:
        print(
            "Missing DATABASE_URL in backend/.env — copy the Postgres URI from "
            "Supabase → Settings → Database.",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        files = sorted(f.name for f in MIGRATIONS_DIR.iterdir() if f.suffix == ".sql")
    except OSError as e:
        print("Cannot read migrations folder:", MIGRATIONS_DIR, e, file=sys.stderr)
        sys.exit(1)

    if not files:
        print("No .sql files in", MIGRATIONS_DIR)
        return

    connect_kwargs: dict = {"conninfo": url}
    if "localhost" not in url and "127.0.0.1" not in url:
        connect_kwargs["sslmode"] = "require"

    with psycopg.connect(**connect_kwargs) as conn:
        conn.autocommit = False
        ensure_migrations_table(conn)
        conn.commit()

        for name in files:
            if from_ts and file_timestamp(name) < from_ts:
                print("[skip --from]", name)
                continue

            row = conn.execute(
                "select 1 from public.schema_migrations where filename = %s",
                (name,),
            ).fetchone()
            if row:
                print("[already applied]", name)
                continue

            sql = (MIGRATIONS_DIR / name).read_text(encoding="utf-8")
            print("[running]", name)
            try:
                conn.execute(sql)
                conn.execute(
                    "insert into public.schema_migrations (filename) values (%s)",
                    (name,),
                )
                conn.commit()
                print("[ok]", name)
            except Exception as e:
                conn.rollback()
                print("[failed]", name, e, file=sys.stderr)
                sys.exit(1)

    print("Done.")


if __name__ == "__main__":
    main()
