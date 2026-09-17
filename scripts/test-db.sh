#!/usr/bin/env bash
# Builds a throwaway database, applies every migration + seed, runs the SQL test suite.
# Usage: scripts/test-db.sh            (needs a local Postgres 15+ and psql)
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-growth_os_test}"
PSQL="${PSQL:-psql}"
run() { $PSQL -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

$PSQL -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run -f supabase/tests/_supabase_stub.sql
run -c "create extension if not exists pgcrypto with schema extensions; create extension if not exists citext with schema extensions;"
for f in supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  run -f "$f" > /dev/null
done
echo "seed     supabase/seed.sql"
run -f supabase/seed.sql > /dev/null
for f in supabase/tests/[0-9]*.sql; do
  echo "test     $(basename "$f")"
  run -f "$f" > /dev/null
done
echo "ALL TESTS PASSED"
