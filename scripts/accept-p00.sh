#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  pnpm infra:down
  pnpm infra:reset
  exit "$status"
}

cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  printf 'Error: .env is missing. Run cp .env.example .env first.\n' >&2
  exit 1
fi

trap cleanup EXIT

baseline_tree_before="$(git rev-parse HEAD:artifacts/lpbot/2026-08-13)"
printf 'Frozen baseline tree before acceptance: %s\n' "$baseline_tree_before"

pnpm infra:reset

pnpm check:all
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

pnpm infra:up
pnpm db:migrate
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm infra:verify
pnpm test:infra

pnpm test:e2e
forge fmt --check
forge build
pnpm test:contracts

pnpm check:baseline
baseline_tree_after="$(git rev-parse HEAD:artifacts/lpbot/2026-08-13)"
git diff --quiet -- artifacts/lpbot/2026-08-13

if [[ "$baseline_tree_before" != "$baseline_tree_after" ]]; then
  printf 'Error: frozen baseline tree changed from %s to %s.\n' "$baseline_tree_before" "$baseline_tree_after" >&2
  exit 1
fi

printf 'Frozen baseline tree after acceptance:  %s\n' "$baseline_tree_after"
printf 'P00 full-stack acceptance passed.\n'
