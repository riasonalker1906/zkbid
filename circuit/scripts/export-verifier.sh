#!/usr/bin/env bash
# export-verifier.sh -- Generate ZKVerifier.sol for Person 1
# Output: contracts/ZKVerifier.sol (checked in to repo, handed to smart contract dev)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

ACIR="$ROOT/target/zkbid.json"
VK="$ROOT/target/vk/vk"

if [ ! -f "$ACIR" ]; then
  echo "[export-verifier] Compiling circuit first..."
  cd "$ROOT" && nargo compile
fi

if [ ! -f "$VK" ]; then
  echo "[export-verifier] Generating verification key..."
  mkdir -p "$ROOT/target/vk"
  bb write_vk -b "$ACIR" -t evm -o "$ROOT/target/vk"
fi

mkdir -p "$ROOT/contracts"

echo "[export-verifier] Generating Solidity verifier..."
bb write_solidity_verifier \
  -k "$VK" \
  -t evm \
  -o "$ROOT/contracts/ZKVerifier.sol"

echo ""
echo "Generated: contracts/ZKVerifier.sol"
echo ""
echo "Integration note for Person 1:"
echo "  Interface: HonkVerifier.verify(bytes calldata proof, bytes32[] calldata publicInputs)"
echo "  publicInputs length must be 7 (in this order):"
echo "    [0] commitments[0] = Poseidon2(bids[0], salts[0]) as bytes32"
echo "    [1] commitments[1] = Poseidon2(bids[1], salts[1]) as bytes32"
echo "    [2] commitments[2] = Poseidon2(bids[2], salts[2]) as bytes32"
echo "    [3] commitments[3] = Poseidon2(bids[3], salts[3]) as bytes32"
echo "    [4] commitments[4] = Poseidon2(bids[4], salts[4]) as bytes32"
echo "    [5] winner_index   as bytes32 (u32 zero-padded)"
echo "    [6] second_price   as bytes32 (Field element, <= 2^64)"
echo "  proof bytes come from: bb prove output file"
