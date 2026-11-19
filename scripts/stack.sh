#!/usr/bin/env bash
# Single entry point to Docker Compose: adds the files and profile for DEPLOY_MODE.
# Other scripts call it instead of "docker compose" so edge mode keeps its overlay.
set -euo pipefail
cd "$(dirname "$0")/.."
# cron and the deploy SSH key run without a login shell; Bun lives in ~/.bun.
export PATH="$HOME/.bun/bin:$PATH"
exec bun scripts/stack.ts "$@"
