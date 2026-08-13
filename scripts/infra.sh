#!/usr/bin/env bash
set -euo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly COMPOSE_FILE="$ROOT_DIR/infra/docker/compose.yaml"
readonly PROJECT_NAME="lpbot-p00-local"

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

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    printf 'Error: Docker CLI is not installed.\n' >&2
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    printf 'Error: Docker daemon is not available. Start Docker and retry.\n' >&2
    exit 1
  fi
}

timeout_seconds() {
  local value="${INFRA_WAIT_TIMEOUT_SECONDS:-}"

  if [[ -z "$value" ]]; then
    value="$(sed -n 's/^INFRA_WAIT_TIMEOUT_SECONDS=//p' "$ENV_FILE" | tail -n 1)"
  fi
  value="${value:-120}"

  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    printf 'Error: INFRA_WAIT_TIMEOUT_SECONDS must be a positive integer.\n' >&2
    exit 1
  fi

  printf '%s' "$value"
}

show_failure_status() {
  printf 'LPBot local service status:\n' >&2
  compose ps --all >&2 || true
}

up() {
  local timeout
  timeout="$(timeout_seconds)"
  printf 'Starting LPBot local infrastructure (timeout: %ss)...\n' "$timeout"

  if ! compose up --detach --wait --wait-timeout "$timeout" postgres redis minio anvil; then
    printf 'Error: LPBot services did not become healthy before the timeout.\n' >&2
    show_failure_status
    exit 1
  fi

  if ! compose run --rm --no-deps minio-init; then
    printf 'Error: MinIO bucket initialization failed after MinIO became healthy.\n' >&2
    show_failure_status
    exit 1
  fi

  printf 'LPBot local infrastructure is healthy.\n'
  compose ps postgres redis minio anvil
}

down() {
  compose down --remove-orphans
}

status() {
  compose ps --all
}

logs() {
  compose logs --tail="${INFRA_LOG_TAIL:-200}" "$@"
}

reset() {
  local volume label
  local -a volumes=(
    lpbot-p00-local-postgres-data
    lpbot-p00-local-redis-data
    lpbot-p00-local-minio-data
    lpbot-p00-local-anvil-data
  )

  compose down --remove-orphans

  for volume in "${volumes[@]}"; do
    if ! docker volume inspect "$volume" >/dev/null 2>&1; then
      continue
    fi

    label="$(docker volume inspect --format '{{ index .Labels "io.lpbot.local-project" }}' "$volume")"
    if [[ "$label" != "$PROJECT_NAME" ]]; then
      printf 'Error: refusing to remove volume %s because its project label is %s.\n' \
        "$volume" "${label:-missing}" >&2
      exit 1
    fi

    docker volume rm "$volume" >/dev/null
    printf 'Removed local volume %s.\n' "$volume"
  done
}

verify() {
  local container_id health service state
  local -a services=(postgres redis minio anvil)
  local failed=0

  compose config --quiet

  for service in "${services[@]}"; do
    container_id="$(compose ps --quiet "$service")"
    if [[ -z "$container_id" ]]; then
      printf 'Error: %s is not running. Run pnpm infra:up first.\n' "$service" >&2
      failed=1
      continue
    fi

    state="$(docker inspect --format '{{.State.Status}}' "$container_id")"
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id")"
    if [[ "$state" != "running" || "$health" != "healthy" ]]; then
      printf 'Error: %s state=%s health=%s.\n' "$service" "$state" "$health" >&2
      failed=1
    else
      printf '%s: healthy\n' "$service"
    fi
  done

  if ((failed != 0)); then
    show_failure_status
    exit 1
  fi

  compose run --rm --no-deps --entrypoint /bin/sh minio-init -ec \
    'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc stat "local/$MINIO_BUCKET" >/dev/null'

  local chain_id
  chain_id="$(compose exec -T anvil cast rpc eth_chainId --rpc-url http://127.0.0.1:8545 | tr -d '"')"
  if [[ "$chain_id" != "0x7a69" ]]; then
    printf 'Error: Anvil returned chain ID %s; expected 0x7a69.\n' "$chain_id" >&2
    exit 1
  fi

  printf 'MinIO bucket: ready\n'
  printf 'Anvil chain ID: 0x7a69\n'
}

usage() {
  printf 'Usage: %s {up|down|status|logs|reset|verify}\n' "$0" >&2
  exit 2
}

require_docker

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  logs)
    shift
    logs "$@"
    ;;
  reset) reset ;;
  verify) verify ;;
  *) usage ;;
esac
