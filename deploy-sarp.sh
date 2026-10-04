#!/usr/bin/env bash
set -euo pipefail

LOCKFILE="/tmp/sarp-deploy.lock"
exec 200>"$LOCKFILE"
if ! flock -n 200; then
  echo "Another deploy is already running, skipping."
  exit 0
fi

ROOT_DIR="/opt/sarp-project"
BOT_DIR="$ROOT_DIR/sarp-utilities"
DJSKO_DIR="$ROOT_DIR/djsko"
BRANCH="main"

# Records the bot+djsko commits of the last SUCCESSFUL build. Deciding from
# this (not from "did git pull bring anything") means a build that failed
# after pulling is retried next run instead of being skipped forever.
STATE_FILE="$ROOT_DIR/.deployed-sarp-utilities"

for REPO_DIR in "$BOT_DIR" "$DJSKO_DIR"; do
  cd "$REPO_DIR"
  # Hand edits on the server (chmod, npm install, ...) used to make every
  # pull fail. Stash them instead; `git stash list` still has them.
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Stashing local changes in $(basename "$REPO_DIR"):"
    git status --short --untracked-files=no
    git stash push -m "deploy auto-stash $(date -u +%FT%TZ)"
  fi
  git pull --ff-only origin "$BRANCH"
done

CURRENT="$(git -C "$BOT_DIR" rev-parse HEAD) $(git -C "$DJSKO_DIR" rev-parse HEAD)"
if [ -f "$STATE_FILE" ] && [ "$(cat "$STATE_FILE")" = "$CURRENT" ]; then
  echo "Already deployed $CURRENT, nothing to do."
  exit 0
fi
echo "Deploying $CURRENT"

cd "$ROOT_DIR"
docker build -f sarp-utilities/Dockerfile -t sarp-utilities:latest .

# --network host lets the throwaway container reach Postgres at
# localhost:5432 the same way the systemd-run container does.
docker run --rm --network host --env-file sarp-utilities/.env sarp-utilities:latest npm run db:update

systemctl --user restart sarp-utilities.service

echo "$CURRENT" > "$STATE_FILE"
echo "Deploy complete."
