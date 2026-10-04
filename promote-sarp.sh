#!/usr/bin/env bash
# Promotes testing -> prod: fast-forwards main to testing in every repo this
# bot deploys from. The push fires the GitHub webhook, which deploys.
# Paths/branch mirror deploy-sarp.sh.
set -euo pipefail

export XDG_RUNTIME_DIR="/run/user/$(id -u)"

ROOT_DIR="/opt/sarp-project"
BOT_DIR="$ROOT_DIR/sarp-utilities"
DJSKO_DIR="$ROOT_DIR/djsko"
BRANCH="main"
SOURCE_BRANCH="testing"

# Check every repo first so a non-fast-forward in one never leaves the
# others half-promoted.
for REPO_DIR in "$BOT_DIR" "$DJSKO_DIR"; do
  cd "$REPO_DIR"
  # Explicit refspecs: the server clones only track main, so a plain
  # `git fetch origin testing` would never create origin/testing.
  git fetch origin \
    "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" \
    "+refs/heads/$SOURCE_BRANCH:refs/remotes/origin/$SOURCE_BRANCH"
  if ! git merge-base --is-ancestor origin/"$BRANCH" origin/"$SOURCE_BRANCH"; then
    echo "$(basename "$REPO_DIR"): $BRANCH has commits not in $SOURCE_BRANCH, can't fast-forward. Merge $BRANCH into $SOURCE_BRANCH first."
    exit 1
  fi
done

for REPO_DIR in "$BOT_DIR" "$DJSKO_DIR"; do
  cd "$REPO_DIR"
  echo "$(basename "$REPO_DIR"): $BRANCH $(git rev-parse --short origin/"$BRANCH") -> $(git rev-parse --short origin/"$SOURCE_BRANCH")"
  git push origin "origin/$SOURCE_BRANCH:refs/heads/$BRANCH"
done

echo "Pushed. The webhook deploy takes it from here."
