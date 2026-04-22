#!/usr/bin/env bash
# verify.sh -- Verify a proof locally
# Usage: ./scripts/verify.sh [proof-dir]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

PROOF_DIR="${1:-$ROOT/proof}"
VK="$ROOT/target/vk/vk"
ACIR="$ROOT/target/zkbid.json"

if [ ! -f "$ACIR" ]; then
  echo "Error: Circuit not compiled. Run scripts/compile.sh first."
  exit 1
fi

if [ ! -f "$VK" ]; then
  echo "[verify] Generating verification key..."
  mkdir -p "$ROOT/target/vk"
  bb write_vk -b "$ACIR" -t evm -o "$ROOT/target/vk"
fi

echo "[verify] Verifying proof at $PROOF_DIR/proof..."
bb verify \
  -k "$VK" \
  -p "$PROOF_DIR/proof" \
  -i "$PROOF_DIR/public_inputs" \
  -t evm 2>&1

echo "[verify] Proof is VALID."
