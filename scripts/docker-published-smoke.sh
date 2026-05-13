#!/usr/bin/env bash
set -euo pipefail

IMAGE="${IMAGE:-mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm}"
REPO="${REPO:-https://github.com/heroku/node-js-getting-started.git}"
WORKDIR="${WORKDIR:-/workspaces}"
INSTALL_FROM="npm"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage: docker-published-smoke.sh [--local]

Runs a Docker smoke test against a sample Node.js repo, then leaves you in an
interactive shell inside the container.

Options:
  --local   Install agent-validator from this checkout instead of npm.
  -h, --help
            Show this help.

Environment:
  IMAGE     Docker image to use.
  REPO      Git repo to clone inside the container.
  WORKDIR   Container working directory.
USAGE
}

while (($#)); do
  case "$1" in
    --local)
      INSTALL_FROM="local"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

docker_args=(
  --rm
  -it
  -w "$WORKDIR"
  -e "REPO=$REPO"
  -e "INSTALL_FROM=$INSTALL_FROM"
  -e "WORKDIR=$WORKDIR"
  -e "USER=root"
)

if [[ "$INSTALL_FROM" == "local" ]]; then
  docker_args+=(-v "$VALIDATOR_ROOT:/agent-validator-source:ro")
fi

docker run "${docker_args[@]}" \
  "$IMAGE" \
  bash -lc '
    set -euo pipefail

    git clone "$REPO"
    cd node-js-getting-started

    npm ci

    npm install -g bun @openai/codex @anthropic-ai/claude-code
    if [[ "$INSTALL_FROM" == "local" ]]; then
      mkdir -p /tmp/agent-validator-local
      tar \
        --exclude ./node_modules \
        --exclude ./.git \
        --exclude ./dist \
        --exclude ./validator_logs \
        -C /agent-validator-source \
        -cf - . | tar -C /tmp/agent-validator-local -xf -
      cd /tmp/agent-validator-local
      bun install --frozen-lockfile
      bun run build:npm
      npm install -g /tmp/agent-validator-local
      cd "$WORKDIR/node-js-getting-started"
    else
      npm install -g agent-validator
    fi
    npm install -g @codagent-ai/agent-plugin

    agent-validator --version
    agent-plugin --version
    codex --version
    claude --version

    echo
    echo "Setup complete. You are now in the sample repo inside the container."
    exec bash -l
  '
