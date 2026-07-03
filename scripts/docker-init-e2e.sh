#!/usr/bin/env bash
set -euo pipefail

IMAGE="${IMAGE:-mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm}"
WORKDIR="${WORKDIR:-/workspaces}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage: docker-init-e2e.sh

Runs an opt-in Docker E2E test for `agent-validator init --yes` with real
Claude Code, Codex, npm agent-plugin dependency, and Vercel skills installs.

Environment:
  IMAGE    Docker image to use.
  WORKDIR  Container working directory.
USAGE
}

while (($#)); do
  case "$1" in
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
  -w "$WORKDIR"
  -e "WORKDIR=$WORKDIR"
  -e "USER=root"
  -v "$VALIDATOR_ROOT:/agent-validator-source:ro"
)

if [[ -t 0 && -t 1 ]]; then
  docker_args+=(-it)
fi

docker run "${docker_args[@]}" \
  "$IMAGE" \
  bash -lc '
    set -euo pipefail

    copy_source() {
      local src="$1"
      local dest="$2"
      mkdir -p "$dest"
      tar \
        --exclude ./node_modules \
        --exclude ./.git \
        --exclude ./dist \
        --exclude ./validator_logs \
        -C "$src" \
        -cf - . | tar -C "$dest" -xf -
    }

    require_file() {
      local path="$1"
      if [[ ! -f "$path" ]]; then
        echo "Missing expected file: $path" >&2
        exit 1
      fi
    }

    require_dir() {
      local path="$1"
      if [[ ! -d "$path" ]]; then
        echo "Missing expected directory: $path" >&2
        exit 1
      fi
    }

    require_output_contains() {
      local command="$1"
      local expected="$2"
      local output
      output="$(eval "$command")"
      printf "%s\n" "$output"
      if [[ "$output" != *"$expected"* ]]; then
        echo "Expected output from \`$command\` to contain: $expected" >&2
        exit 1
      fi
    }

    echo "Installing runtime CLIs..."
    npm install -g bun @openai/codex @anthropic-ai/claude-code
    codex --version
    claude --version

    echo "Building and installing local agent-validator..."
    copy_source /agent-validator-source /tmp/agent-validator-local
    cd /tmp/agent-validator-local
    bun install --frozen-lockfile
    node -e "console.log(require.resolve(\"agent-plugin/package.json\"))"
    bun run build:npm
    npm install -g /tmp/agent-validator-local
    agent-validator --version

    echo "Running init in an empty project..."
    mkdir -p "$WORKDIR/validator-init-e2e"
    cd "$WORKDIR/validator-init-e2e"
    agent-validator init --yes

    echo "Verifying project scaffold..."
    require_file .validator/config.yml
    require_file .gitignore
    grep -q "validator_logs" .gitignore
    grep -q "default_preference:" .validator/config.yml
    grep -q -- "- codex" .validator/config.yml
    grep -q -- "- claude" .validator/config.yml

    echo "Verifying Claude plugin install..."
    require_output_contains "claude plugin list" "agent-validator"

    echo "Verifying Codex plugin install..."
    codex plugin list | tee /tmp/codex-plugins.txt
    grep -Eq "agent-validator@agent-validator[[:space:]]+installed" /tmp/codex-plugins.txt

    echo
    echo "Docker init E2E passed."
  '
