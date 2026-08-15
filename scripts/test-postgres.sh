#!/usr/bin/env bash
set -euo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -n "${LPBOT_ENV_FILE:-}" ]]; then
  readonly ENV_FILE="$LPBOT_ENV_FILE"
elif [[ -f "$ROOT_DIR/.env" ]]; then
  readonly ENV_FILE="$ROOT_DIR/.env"
else
  readonly ENV_FILE="$ROOT_DIR/.env.example"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | tail -n 1)"
fi

if [[ -z "$DATABASE_URL" ]]; then
  printf 'Error: DATABASE_URL is required for PostgreSQL integration tests.\n' >&2
  exit 1
fi

export DATABASE_URL
cd "$ROOT_DIR"
pnpm --filter @lpbot/api^... --filter @lpbot/indexer^... build
pnpm exec vitest run --config vitest.postgres.config.ts
