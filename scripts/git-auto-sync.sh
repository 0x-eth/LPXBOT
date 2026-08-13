#!/bin/bash

set -uo pipefail

readonly REPO_DIR="/Users/alpha/Documents/LPXBOT"
readonly BRANCH="main"
readonly LOCK_DIR="${TMPDIR:-/tmp}/lpxbot-git-auto-sync.lock"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$LOCK_DIR/pid"
    return 0
  fi

  local owner_pid
  owner_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$owner_pid" ]] && kill -0 "$owner_pid" 2>/dev/null; then
    return 1
  fi

  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" 2>/dev/null || return 1
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
}

if ! acquire_lock; then
  exit 0
fi
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

cd "$REPO_DIR" || {
  log "Repository directory is unavailable: $REPO_DIR"
  exit 1
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "Not a Git repository: $REPO_DIR"
  exit 1
fi

git add -A
if ! git diff --cached --quiet; then
  if ! git commit -m "chore: auto-sync $(date '+%Y-%m-%d %H:%M:%S %z')"; then
    log "Commit failed; changes remain staged"
    exit 1
  fi
fi

if ! git fetch --quiet origin "$BRANCH"; then
  log "Fetch failed; committed changes remain local for the next run"
  exit 1
fi

readonly REMOTE_REF="refs/remotes/origin/$BRANCH"
if ! git merge-base --is-ancestor "$REMOTE_REF" HEAD; then
  if [[ -n "$(git status --porcelain)" ]]; then
    log "Files changed during sync; deferring remote rebase until the next run"
    exit 0
  fi

  if ! git rebase "$REMOTE_REF"; then
    git rebase --abort >/dev/null 2>&1 || true
    log "Remote changes conflict with local commits; rebase was aborted"
    exit 1
  fi
fi

if ! git push --quiet origin "HEAD:$BRANCH"; then
  log "Push failed; the next run will retry"
  exit 1
fi

log "Sync complete at $(git rev-parse --short HEAD)"
