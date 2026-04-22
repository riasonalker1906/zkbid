#!/usr/bin/env bash
# compile.sh -- Compile the zkbid circuit to ACIR format
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

export PATH="$HOME/.nargo/bin:$PATH"

echo "[compile] Compiling zkbid circuit..."
cd "$ROOT" && nargo compile --force

echo ""
echo "[compile] Circuit info:"
nargo info 2>&1

echo ""
echo "[compile] Build artifacts in target/:"
ls "$ROOT/target/"
