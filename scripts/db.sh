#!/usr/bin/env bash
set -euo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly COMPOSE_FILE="$ROOT_DIR/infra/docker/compose.yaml"
readonly PROJECT_NAME="lpbot-p00-local"
readonly SEED_FILE="$ROOT_DIR/infra/seed.sql"

if [[ -n "${LPBOT_ENV_FILE:-}" ]]; then
  readonly ENV_FILE="$LPBOT_ENV_FILE"
elif [[ -f "$ROOT_DIR/.env" ]]; then
  readonly ENV_FILE="$ROOT_DIR/.env"
else
  readonly ENV_FILE="$ROOT_DIR/.env.example"
fi

compose() {
  docker compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    --file "$COMPOSE_FILE" \
    "$@"
}

command_timeout_seconds() {
  local value="${INFRA_COMMAND_TIMEOUT_SECONDS:-}"

  if [[ -z "$value" ]]; then
    value="$(sed -n 's/^INFRA_COMMAND_TIMEOUT_SECONDS=//p' "$ENV_FILE" | tail -n 1)"
  fi
  value="${value:-30}"

  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    printf 'Error: INFRA_COMMAND_TIMEOUT_SECONDS must be a positive integer.\n' >&2
    exit 1
  fi

  printf '%s' "$value"
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
  local operation="$1"
  local status=0 timeout
  timeout="$(command_timeout_seconds)"

  compose --profile tools run --rm --no-deps --entrypoint /usr/bin/timeout \
    dbmate "$timeout" dbmate "$@" || status=$?

  if [[ "$status" -eq 124 ]]; then
    printf 'Error: database %s exceeded the %ss command timeout.\n' "$operation" "$timeout" >&2
  fi
  return "$status"
}

migrate() {
  dbmate migrate
}

status() {
  dbmate status
}

seed() {
  local status=0 timeout
  timeout="$(command_timeout_seconds)"

  compose exec -T postgres timeout "$timeout" sh -ec \
    'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --quiet' \
    <"$SEED_FILE" || status=$?

  if [[ "$status" -eq 124 ]]; then
    printf 'Error: database seed exceeded the %ss command timeout.\n' "$timeout" >&2
  fi
  if [[ "$status" -ne 0 ]]; then
    return "$status"
  fi
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
