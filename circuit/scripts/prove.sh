#!/usr/bin/env bash
# prove.sh -- Generate a proof from a Prover.toml
# Usage: ./scripts/prove.sh [path/to/Prover.toml] [proof-output-dir]
#
# Workflow:
#   1. nargo execute  -- solve the circuit, write witness to target/
#   2. bb write_vk    -- generate verification key (cached in target/vk/)
#   3. bb prove       -- generate proof from ACIR + witness
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

PROVER_TOML="${1:-$ROOT/Prover.toml}"
PROOF_DIR="${2:-$ROOT/proof}"

if [ ! -f "$PROVER_TOML" ]; then
  echo "Error: Prover.toml not found at $PROVER_TOML"
  exit 1
fi

if [ "$PROVER_TOML" != "$ROOT/Prover.toml" ]; then
  cp "$PROVER_TOML" "$ROOT/Prover.toml"
fi

mkdir -p "$PROOF_DIR"

cd "$ROOT"

# Step 1: Compile if needed
ACIR="$ROOT/target/zkbid.json"
if [ ! -f "$ACIR" ]; then
  echo "[prove] Compiling circuit..."
  nargo compile
fi

# Step 2: Execute (generate witness)
echo "[prove] Solving circuit (generating witness)..."
nargo execute zkbid_witness

WITNESS="$ROOT/target/zkbid_witness.gz"

# Step 3: Write verification key (idempotent)
VK="$ROOT/target/vk/vk"
if [ ! -f "$VK" ]; then
  echo "[prove] Generating verification key..."
  bb write_vk -b "$ACIR" -k "$VK" -t evm -o "$ROOT/target/vk"
fi

# Step 4: Generate proof
echo "[prove] Generating proof..."
bb prove \
  -b "$ACIR" \
  -w "$WITNESS" \
  -k "$VK" \
  -t evm \
  -o "$PROOF_DIR"

echo ""
echo "[prove] Artifacts:"
ls "$PROOF_DIR/"
echo "[prove] Done. Verify with: ./scripts/verify.sh $PROOF_DIR"
