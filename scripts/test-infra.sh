#!/usr/bin/env bash
set -euo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"
bash scripts/infra.sh verify
bash scripts/db.sh migrate
bash scripts/db.sh seed
node --test --test-concurrency=1 tests/infra/compose-config.test.mjs tests/infra/services.test.mjs
