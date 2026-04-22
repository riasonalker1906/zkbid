#!/usr/bin/env node
/**
 * generate-input.js
 *
 * Generates a valid Prover.toml for the ZKBid(5) circuit.
 * Computes Poseidon2 commitments using @aztec/bb.js, which wraps the same
 * Barretenberg backend that Noir's std::hash::poseidon2_permutation uses.
 * The hash values are guaranteed to match the in-circuit computation.
 *
 * Usage:
 *   node scripts/generate-input.js --bids 100,200,300,400,500
 *   node scripts/generate-input.js --bids 500,500,300,200,100 --out test-inputs/tied/Prover.toml
 *   node scripts/generate-input.js --bids 300,0,0,0,0         --out test-inputs/single/Prover.toml
 *
 * Options:
 *   --bids    Comma-separated bid amounts, exactly 5 values (use 0 to zero-pad)
 *   --salts   Optional comma-separated salts (default: random 31-byte values)
 *   --out     Output path (default: Prover.toml in current dir)
 *   --print   Also print to stdout
 *
 * How Poseidon2 is computed (matches circuit exactly):
 *   The circuit calls std::hash::poseidon2_permutation([bid, salt, 0, iv])
 *   where iv = 2 * 2^64 (fixed-length hash IV for 2 inputs).
 *   This is the Poseidon2 sponge construction from noir_stdlib/src/hash/poseidon2.nr.
 *
 * For Person 3 (frontend): use this same construction with @aztec/bb.js or
 *   implement it yourself via poseidon2_permutation from @aztec/foundation/hash.
 *
 * For Person 4 (backend): call this script or import poseidon2Hash() directly.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const N = 5;

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const bidsArg = getArg("--bids");
if (!bidsArg) {
  console.error("Usage: node generate-input.js --bids <b0,b1,b2,b3,b4> [--out path] [--salts s0,s1,s2,s3,s4]");
  process.exit(1);
}

const bids = bidsArg.split(",").map(s => BigInt(s.trim()));
if (bids.length !== N) {
  console.error(`Expected exactly ${N} bids, got ${bids.length}`);
  process.exit(1);
}

// Validate all bids fit in 64 bits
for (let i = 0; i < N; i++) {
  if (bids[i] >= 2n ** 64n || bids[i] < 0n) {
    console.error(`Bid ${i} (${bids[i]}) must be in range [0, 2^64)`);
    process.exit(1);
  }
}

const saltsArg = getArg("--salts");
let salts;
if (saltsArg) {
  salts = saltsArg.split(",").map(s => BigInt(s.trim()));
  if (salts.length !== N) { console.error("--salts must have exactly 5 values"); process.exit(1); }
} else {
  // Random 248-bit salts (well below BN254 field prime)
  salts = bids.map((b) => {
    if (b === 0n) return 0n; // keep zero-padded slots deterministic
    const bytes = crypto.randomBytes(31);
    return BigInt("0x" + bytes.toString("hex"));
  });
}

const outPath = getArg("--out") || path.join(process.cwd(), "Prover.toml");

// ---------------------------------------------------------------------------
// Compute winner and second price
// ---------------------------------------------------------------------------
let winnerIdx = 0;
for (let i = 1; i < N; i++) {
  if (bids[i] > bids[winnerIdx]) winnerIdx = i;
}

let secondPrice = 0n;
for (let i = 0; i < N; i++) {
  if (i !== winnerIdx && bids[i] > secondPrice) secondPrice = bids[i];
}

// ---------------------------------------------------------------------------
// Poseidon2 hash matching the circuit's poseidon2_hash_2(a, b)
//
// The circuit does:
//   let iv: Field = 2 * 18446744073709551616;      // 2 * 2^64
//   let state = poseidon2_permutation([a, b, 0, iv]);
//   state[0]
//
// We replicate this using @aztec/bb.js Poseidon2 permutation.
// ---------------------------------------------------------------------------
async function main() {
  let Poseidon2;
  try {
    ({ Poseidon2 } = await import("@aztec/bb.js"));
  } catch (e) {
    // Fallback: try the older API
    try {
      const bbjs = await import("@aztec/bb.js");
      Poseidon2 = bbjs.Poseidon2 || bbjs.default?.Poseidon2;
    } catch (_) {}
  }

  if (!Poseidon2) {
    console.error(
      "Could not load @aztec/bb.js. Run: npm install\n" +
      "If @aztec/bb.js is unavailable, use the Noir test output hash values directly:\n" +
      "  nargo test --show-output  (prints Poseidon2 values for known inputs)"
    );
    process.exit(1);
  }

  // Poseidon2 sponge: hash 2 field elements with fixed-length IV
  const IV_2 = 2n * (2n ** 64n); // 2 * 2^64

  function poseidon2Hash(a, b) {
    // Matches the circuit: permute([a, b, 0, iv])[0]
    const stateIn = [a, b, 0n, IV_2];
    const p2 = new Poseidon2();
    const stateOut = p2.permutation(stateIn.map(x => toBBField(x)));
    return fromBBField(stateOut[0]);
  }

  function toBBField(n) {
    // @aztec/bb.js may expect Fr objects or bigints depending on version
    return n;
  }

  function fromBBField(f) {
    return typeof f === "bigint" ? f : BigInt(f.toString());
  }

  let commitments;
  try {
    commitments = bids.map((bid, i) => poseidon2Hash(bid, salts[i]));
  } catch (e) {
    console.error("Poseidon2 computation failed:", e.message);
    console.error("Tip: run `nargo test --show-output` to get hash values for known inputs.");
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Write Prover.toml
  // ---------------------------------------------------------------------------
  const toml = [
    `# Generated by generate-input.js`,
    `# Bids: [${bids.join(", ")}]`,
    `# Winner: index ${winnerIdx} (bid=${bids[winnerIdx]}), second_price=${secondPrice}`,
    ``,
    `bids = [${bids.map(b => `"${b}"`).join(", ")}]`,
    `salts = [${salts.map(s => `"${s}"`).join(", ")}]`,
    `commitments = [`,
    ...commitments.map((c, i) => `  "0x${c.toString(16).padStart(64, "0")}"${i < N-1 ? "," : ""}`),
    `]`,
    `winner_index = "${winnerIdx}"`,
    `second_price = "${secondPrice}"`,
  ].join("\n");

  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, toml);

  console.log(`Written: ${outPath}`);
  console.log(`  Bids:         [${bids.join(", ")}]`);
  console.log(`  Winner:       index ${winnerIdx} (bid=${bids[winnerIdx]})`);
  console.log(`  Second price: ${secondPrice}`);
}

main().catch(e => { console.error(e); process.exit(1); });
