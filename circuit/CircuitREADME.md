---

**Folder:** `circuit/`  
**Tools:** Noir (circuit language) + Barretenberg (prover)  
**Responsibility:** Write the circuit, generate the Solidity verifier contract, test all scenarios.

---

## What the Circuit Proves

Given:
- **Private:** the actual bid amounts and the random salts used to hash them
- **Public:** the on-chain commitment hashes, the declared winner index, and the declared second price

The circuit proves three things:

| # | What | How |
|---|------|-----|
| 1 | Each bidder's commitment matches their actual bid | `Poseidon2(bid, salt) == commitment` for all 5 slots |
| 2 | The declared winner actually has the highest bid | `winner_bid >= all other bids` (with lowest-index tiebreak) |
| 3 | The declared second price is correct | `second_price == max bid among all non-winners` |

> **Note:** The circuit does **not** compute who the winner is. The auctioneer determines the winner off-chain and declares it as a public input. The circuit's job is to make it impossible to lie about that declaration.

---

## Setup

### Install Nargo (Noir compiler)

```bash
curl -L https://raw.githubusercontent.com/noir-lang/noirup/refs/heads/main/install | bash
noirup
```

### Install bb (Barretenberg prover)

```bash
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash
bbup -v 5.0.0-nightly.20260324
```

> **Important:** The bb version must match Nargo. This project uses Nargo `1.0.0-beta.20` + bb `5.0.0-nightly.20260324`.

### Add to PATH (add this to your shell profile)

```bash
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"
```

---

## Running Tests

### Fast unit tests (no proof generation)

```bash
cd circuit/
nargo test --show-output
```

All 9 tests should pass:

```
✓ test_basic_distinct_bids
✓ test_tied_highest
✓ test_single_bidder
✓ test_all_equal
✓ test_tampered_winner_should_fail
✓ test_tampered_price_should_fail
✓ test_tampered_commitment_should_fail
✓ test_tiebreak_violation_should_fail
✓ test_print_hash_values
```

### Full prove + verify round-trip

```bash
cd circuit/
bash scripts/run-tests.sh
```

This compiles the circuit, generates a proof for each valid scenario, verifies it, and confirms the tampered inputs are rejected.

---

## Test Scenarios

| Scenario | Bids | Winner | Second Price | Should |
|----------|------|--------|--------------|--------|
| `basic` | 100, 200, 300, 400, **500** | index 4 | 400 | Pass |
| `tied` | **500**, 500, 300, 200, 100 | index 0 | 500 | Pass |
| `single` | **300**, 0, 0, 0, 0 | index 0 | 0 | Pass |
| `all-equal` | **250**, 250, 250, 250, 250 | index 0 | 250 | Pass |
| `tampered-winner` | 100–500, but wrong winner declared | — | — | Fail |
| `tampered-price` | 100–500, but wrong second price | — | — | Fail |
| `tampered-commitment` | Fake bids, real commitments | — | — | Fail |

Tiebreak rule: when multiple bidders share the highest bid, the **lowest index wins**.

---

## Circuit Size

```
235 ACIR opcodes  (very lean — comparable to a few hundred constraints)
Proving system: UltraHonk (Barretenberg, EVM-compatible)
No trusted setup required.
```

---

## Integration Notes for Teammates

### For Person 1 (Smart Contracts)

The generated verifier is at `circuit/contracts/ZKVerifier.sol`. Deploy it alongside `AuctionManager.sol`.

Call the verifier like this:

```solidity
HonkVerifier verifier = new HonkVerifier();

bytes32[] memory publicInputs = new bytes32[](7);
publicInputs[0] = bytes32(commitments[0]);   // Poseidon2(bids[0], salts[0])
publicInputs[1] = bytes32(commitments[1]);
publicInputs[2] = bytes32(commitments[2]);
publicInputs[3] = bytes32(commitments[3]);
publicInputs[4] = bytes32(commitments[4]);
publicInputs[5] = bytes32(winnerIndex);       // u32, zero-padded
publicInputs[6] = bytes32(secondPrice);       // field element

require(verifier.verify(proof, publicInputs), "Invalid ZK proof");
```

The `proof` bytes come from Person 4's backend (`bb prove` output).

**Public input order matters — must match exactly:**

| Index | Value |
|-------|-------|
| 0–4 | `commitments[0]` through `commitments[4]` |
| 5 | `winner_index` |
| 6 | `second_price` |

---

### For Person 3 (Frontend)

To compute commitment hashes client-side, use `@aztec/bb.js` — it uses the same Barretenberg Poseidon2 as the circuit:

```js
import { Poseidon2 } from "@aztec/bb.js";

const IV_2 = 2n * (2n ** 64n);

function commitment(bid, salt) {
    const p2 = new Poseidon2();
    const state = p2.permutation([bid, salt, 0n, IV_2]);
    return state[0]; // BigInt
}
```

**Sanity check:** `commitment(0n, 0n)` should equal:
```
0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1
```
That's the hash used for zero-padded (unused) bidder slots.

---

### For Person 4 (Auctioneer Backend)

**Step 1 — Generate a Prover.toml from bid data:**

```bash
node circuit/scripts/generate-input.js --bids 100,200,300,400,500
```

**Step 2 — Solve the circuit:**

```bash
nargo execute zkbid_witness
```

**Step 3 — Generate the proof:**

```bash
bb prove \
  -b circuit/target/zkbid.json \
  -w circuit/target/zkbid_witness.gz \
  -k circuit/target/vk/vk \
  -t evm \
  -o /tmp/proof/
```

The proof file is at `/tmp/proof/proof`. Submit these bytes to the smart contract.

---

## Folder Structure (circuit/)

```
circuit/
├── src/
│   └── main.nr              ← the circuit
├── scripts/
│   ├── compile.sh           ← nargo compile
│   ├── prove.sh             ← generate a proof from a Prover.toml
│   ├── verify.sh            ← verify a proof locally
│   ├── export-verifier.sh   ← regenerate ZKVerifier.sol
│   ├── generate-input.js    ← create Prover.toml from bid amounts
│   └── run-tests.sh         ← run all test scenarios
├── test-inputs/
│   ├── basic/Prover.toml
│   ├── tied/Prover.toml
│   ├── single/Prover.toml
│   ├── all-equal/Prover.toml
│   ├── tampered-winner/Prover.toml
│   ├── tampered-price/Prover.toml
│   └── tampered-commitment/Prover.toml
├── contracts/
│   └── ZKVerifier.sol       ← auto-generated, hand off to Person 1
├── Nargo.toml
└── README.md
```
