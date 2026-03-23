#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-}"

if [[ -z "$BRANCH" ]]; then
  echo "Usage: merge-state.sh <branch>" >&2
  exit 1
fi

# Parse git worktree list --porcelain to find the worktree with this branch checked out
SOURCE_DIR=""
while IFS= read -r line; do
  if [[ "$line" =~ ^worktree\ (.+)$ ]]; then
    current_wt="${BASH_REMATCH[1]}"
  elif [[ "$line" == "branch refs/heads/$BRANCH" ]]; then
    SOURCE_DIR="$current_wt"
    break
  fi
done < <(git worktree list --porcelain)

if [[ -z "$SOURCE_DIR" ]]; then
  echo "Error: No worktree found with branch '$BRANCH' checked out — cannot copy execution state." >&2
  exit 1
fi

# Resolve config dir: prefer .validator/, fall back to .gauntlet/
resolve_config() {
  local base="$1"
  if [[ -f "$base/.validator/config.yml" ]]; then
    printf '%s' "$base/.validator/config.yml"
  elif [[ -f "$base/.gauntlet/config.yml" ]]; then
    printf '%s' "$base/.gauntlet/config.yml"
  else
    printf '%s' "$base/.validator/config.yml"
  fi
}

# Read log_dir from a config file; returns "validator_logs" if absent or key not found
read_log_dir() {
  local config_path="$1"
  local parsed=""
  if [[ -f "$config_path" ]]; then
    parsed="$(grep '^log_dir:' "$config_path" | head -n1 | sed 's/^log_dir:[[:space:]]*//' | tr -d '[:space:]')" || true
  fi
  printf '%s' "${parsed:-validator_logs}"
}

# Read source log_dir from source worktree config (default: validator_logs)
SOURCE_CONFIG="$(resolve_config "$SOURCE_DIR")"
SOURCE_LOG_DIR="$(read_log_dir "$SOURCE_CONFIG")"

# Read destination log_dir from current directory config (default: validator_logs)
DEST_CONFIG="$(resolve_config ".")"
DEST_LOG_DIR="$(read_log_dir "$DEST_CONFIG")"

# Verify source execution state exists before merging (fail fast, no partial state)
SOURCE_STATE="$SOURCE_DIR/$SOURCE_LOG_DIR/.execution_state"
if [[ ! -f "$SOURCE_STATE" ]]; then
  echo "Error: Missing source execution state: $SOURCE_STATE — cannot copy execution state." >&2
  exit 1
fi

# Run the merge
git merge "$BRANCH"

# Create destination log directory if it doesn't exist
mkdir -p "$DEST_LOG_DIR"

DEST_STATE="$DEST_LOG_DIR/.execution_state"

# Compare by file identity (inode) to handle symlinks and path form variations
if [[ -e "$DEST_STATE" ]] && [[ "$SOURCE_STATE" -ef "$DEST_STATE" ]]; then
  echo "Merged '$BRANCH'; execution state already current (source and destination are the same)."
  exit 0
fi

cp -f "$SOURCE_STATE" "$DEST_STATE"

echo "Merged '$BRANCH' and copied execution state from '$SOURCE_DIR/$SOURCE_LOG_DIR' to '$DEST_LOG_DIR'."
