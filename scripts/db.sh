#!/usr/bin/env bash
set -euo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly COMPOSE_FILE="$ROOT_DIR/infra/docker/compose.yaml"
readonly SEED_FILE="$ROOT_DIR/infra/seed.sql"

if [[ -n "${LPBOT_ENV_FILE:-}" ]]; then
  readonly ENV_FILE="$LPBOT_ENV_FILE"
elif [[ -f "$ROOT_DIR/.env" ]]; then
  readonly ENV_FILE="$ROOT_DIR/.env"
else
  readonly ENV_FILE="$ROOT_DIR/.env.example"
fi

compose() {
  docker compose --env-file "$ENV_FILE" --file "$COMPOSE_FILE" "$@"
}

require_postgres() {
  local container_id health
  container_id="$(compose ps --quiet postgres)"

  if [[ -z "$container_id" ]]; then
    printf 'Error: PostgreSQL is not running. Run pnpm infra:up first.\n' >&2
    exit 1
  fi

  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id")"
  if [[ "$health" != "healthy" ]]; then
    printf 'Error: PostgreSQL is not healthy (status: %s).\n' "$health" >&2
    exit 1
  fi
}

dbmate() {
  compose --profile tools run --rm --no-deps dbmate "$@"
}

migrate() {
  dbmate migrate
}

status() {
  dbmate status
}

seed() {
  compose exec -T postgres sh -ec \
    'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --quiet' \
    <"$SEED_FILE"
  printf 'Deterministic local seed applied.\n'
}

usage() {
  printf 'Usage: %s {migrate|status|seed}\n' "$0" >&2
  exit 2
}

require_postgres

case "${1:-}" in
  migrate) migrate ;;
  status) status ;;
  seed) seed ;;
  *) usage ;;
esac
