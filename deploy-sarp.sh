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

CHANGED=0

for REPO_DIR in "$BOT_DIR" "$DJSKO_DIR"; do
  cd "$REPO_DIR"
  git fetch origin "$BRANCH"
  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse origin/"$BRANCH")
  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "Changes found in $(basename "$REPO_DIR") ($LOCAL -> $REMOTE), pulling..."
    git pull origin "$BRANCH"
    CHANGED=1
  fi
done

if [ "$CHANGED" -eq 0 ]; then
  echo "No changes in either repo, nothing to deploy."
  exit 0
fi

cd "$ROOT_DIR"
docker build -f sarp-utilities/Dockerfile -t sarp-utilities:latest .

# --network host lets the throwaway container reach Postgres at
# localhost:5432 the same way the systemd-run container does.
docker run --rm --network host --env-file sarp-utilities/.env sarp-utilities:latest npm run db:update

systemctl --user restart sarp-utilities.service

echo "Deploy complete."
