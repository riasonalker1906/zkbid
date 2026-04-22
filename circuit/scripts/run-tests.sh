#!/usr/bin/env bash
# run-tests.sh -- Run all circuit test scenarios
#
# Valid inputs (basic, tied, single, all-equal): prove AND verify must succeed.
# Invalid inputs (tampered-*): nargo execute must FAIL (constraint violation).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
PASS=0; FAIL=0

log_pass() { echo -e "${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
log_fail() { echo -e "${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }

# -----------------------------------------------------------------------
echo "=== Step 1: Compile circuit ==="
cd "$ROOT" && nargo compile --force 2>&1
[ $? -eq 0 ] && log_pass "nargo compile" || { log_fail "nargo compile"; exit 1; }

ACIR="$ROOT/target/zkbid.json"

echo ""
echo "=== Step 2: Unit tests (nargo test) ==="
nargo test 2>&1 | tail -3
[ $? -eq 0 ] && log_pass "nargo unit tests (9/9)" || log_fail "nargo unit tests"

# -----------------------------------------------------------------------
echo ""
echo "=== Step 3: Generate verification key ==="
mkdir -p "$ROOT/target/vk"
bb write_vk -b "$ACIR" -t evm -o "$ROOT/target/vk" 2>&1 | grep -E "VK saved|Error"
VK="$ROOT/target/vk/vk"

# -----------------------------------------------------------------------
run_valid() {
  local name="$1"
  local pdir="$ROOT/test-inputs/$name/proof"
  mkdir -p "$pdir"
  cp "$ROOT/test-inputs/$name/Prover.toml" "$ROOT/Prover.toml"

  nargo execute "${name}_witness" 2>/dev/null
  [ $? -ne 0 ] && log_fail "[$name] witness generation (expected success)" && return

  local witness="$ROOT/target/${name}_witness.gz"
  bb prove -b "$ACIR" -w "$witness" -k "$VK" -t evm -o "$pdir" 2>/dev/null
  [ $? -ne 0 ] && log_fail "[$name] proof generation (expected success)" && return

  bb verify -k "$VK" -p "$pdir/proof" -i "$pdir/public_inputs" -t evm 2>/dev/null
  [ $? -eq 0 ] && log_pass "[$name] prove + verify" || log_fail "[$name] verify (expected valid)"
}

run_invalid() {
  local name="$1"
  cp "$ROOT/test-inputs/$name/Prover.toml" "$ROOT/Prover.toml"
  nargo execute "${name}_witness" 2>/dev/null
  [ $? -ne 0 ] && log_pass "[$name] correctly rejected" || log_fail "[$name] should have been rejected"
}

echo ""
echo "=== Step 4: Valid scenarios ==="
run_valid "basic"
run_valid "tied"
run_valid "single"
run_valid "all-equal"

echo ""
echo "=== Step 5: Invalid scenarios (must fail) ==="
run_invalid "tampered-winner"
run_invalid "tampered-price"
run_invalid "tampered-commitment"

# -----------------------------------------------------------------------
echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}All tests passed.${NC}"
  exit 0
else
  echo -e "${RED}${FAIL} test(s) failed.${NC}"
  exit 1
fi
