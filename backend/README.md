# Person 4 — Auctioneer Backend

Runs the auctioneer as a small HTTP service. Bidders POST encrypted bids during the auction window; once the window is closed the auctioneer decrypts, pulls the on-chain commitments, runs the Noir prover, and returns the proof + public inputs. Submitting to the contract is left to Person 1 (the service just hands back the bytes).

## Layout

```
backend/
├── src/
│   ├── index.ts                  server entrypoint
│   ├── server.ts                 express app + middleware
│   ├── config.ts                 env loading
│   ├── state.ts                  file-backed auction state (data/state.json)
│   ├── util/logger.ts
│   ├── crypto/
│   │   ├── keypair.ts            auctioneer nacl.box keypair (persisted)
│   │   └── decrypt.ts            decrypt bid envelopes
│   ├── chain/commitments.ts      mock + ethers adapters for on-chain commitments
│   ├── auction/
│   │   ├── compute.ts            winner + second-price (matches circuit)
│   │   ├── prove.ts              spawns circuit/scripts/prove.sh
│   │   └── finalize.ts           end-to-end finalize pipeline
│   └── routes/
│       ├── pubkey.ts
│       ├── bids.ts
│       ├── close.ts
│       └── status.ts
├── scripts/
│   └── encrypt-bid.ts            CLI helper for building a POST /bids body
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Setup

```bash
cd backend
cp .env.example .env
npm install
npm run dev            # starts on :8080 with live reload
```

Prereqs:
- Node 20+
- `nargo` and `bb` on `PATH` (needed for `/close`; see root README)
- The circuit folder compiled at least once (`bash ../circuit/scripts/compile.sh`)

On first boot, the server generates an nacl.box keypair at `data/auctioneer.key.json` and writes an empty `data/state.json`. Keep both for the life of an auction — rotating the keypair mid-auction will invalidate bids already submitted.

## Environment

| Var | Default | Notes |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `CIRCUIT_DIR` | `../circuit` | Path to the circuit workspace (used to invoke `scripts/prove.sh`) |
| `DATA_DIR` | `./data` | State + keypair + per-run proof artifacts |
| `NUM_SLOTS` | `5` | Must match `circuit/src/main.nr` |
| `COMMITMENTS_SOURCE` | `mock` | `mock` reads `data/commitments.json`, `ethers` calls on-chain |
| `RPC_URL` | — | Required when `COMMITMENTS_SOURCE=ethers` |
| `AUCTION_ADDRESS` | — | Required when `COMMITMENTS_SOURCE=ethers` |
| `ALLOW_RESET` | `false` | Set `true` in dev to enable `POST /reset` |

## API

### `GET /pubkey`

Returns the auctioneer's nacl.box public key and payload format.

```json
{
  "scheme": "nacl.box",
  "curve": "x25519-xsalsa20-poly1305",
  "publicKey": "<base64, 32 bytes>",
  "numSlots": 5,
  "payloadFormat": { "bid": "...", "salt": "..." }
}
```

### `POST /bids`

Submit one encrypted bid. Idempotent on `slot` — resubmission returns `409`.

Request body:

```json
{
  "slot": 4,
  "bidderAddress": "0xabc...",     // optional hint, not used in proof
  "ephemeralPubkey": "<base64, 32 bytes>",
  "nonce":          "<base64, 24 bytes>",
  "ciphertext":     "<base64>"
}
```

The ciphertext must be `nacl.box(JSON.stringify({bid, salt}), nonce, auctioneerPubkey, ephemeralSecret)` where both `bid` and `salt` are **decimal strings** (bid fits in `u64`, salt is a BN254 field element).

Returns `201` on success, `409` if the auction is not `open` or the slot is taken.

### `POST /close`

Finalizes the auction. The server:

1. Decrypts every stored bid with the auctioneer secret key.
2. Pulls the 5 on-chain commitments from the configured source.
3. Zero-pads any missing slots and cross-checks that those slots have `Poseidon2(0,0)` committed on-chain.
4. Computes `winnerIndex` (highest bid, lowest index breaks ties) and `secondPrice` (max non-winner bid).
5. Writes a `Prover.toml` and invokes `circuit/scripts/prove.sh` to produce `proof` + `public_inputs`.
6. Returns:

```json
{
  "ok": true,
  "winnerIndex": 4,
  "secondPrice": "400",
  "commitments": ["0x...", "0x...", "0x...", "0x...", "0x..."],
  "publicInputs": ["0x...", ...],  // 7 entries: 5 commitments + winner_index + second_price
  "proof": "0x...",
  "finalizedAt": "2026-04-22T..."
}
```

Hand `{proof, publicInputs}` to the smart contract (`HonkVerifier.verify` on `ZKVerifier.sol`). The `publicInputs` ordering is identical to what `circuit/src/main.nr` exports, matching the root README.

Failures set the phase to `error` and return `500` with `lastError`.

### `GET /status`

```json
{
  "phase": "open | closing | finalized | error",
  "numSlots": 5,
  "submittedSlots": [0, 2, 4],
  "commitmentsSource": "mock",
  "result": null,
  "lastError": null
}
```

### `POST /reset` (dev only)

Wipes state and returns the service to `open`. Gated by `ALLOW_RESET=true`.

## Local end-to-end flow (without a live chain)

This is the fastest way to exercise the whole pipeline today while Person 1's contract is still in flight.

```bash
# 1. Make sure the circuit is compiled
( cd ../circuit && bash scripts/compile.sh )

# 2. Start the backend
npm run dev

# 3. In another shell: fetch the auctioneer's nacl pubkey
PK=$(curl -s http://localhost:8080/pubkey | jq -r .publicKey)

# 4. Submit 5 encrypted bids (use salts that match your commitments.json)
for i in 0 1 2 3; do
  npx tsx scripts/encrypt-bid.ts --pubkey "$PK" --slot $i --bid $(( (i+1)*100 )) --salt $((i+1)) \
    | curl -s -H 'content-type: application/json' --data @- http://localhost:8080/bids
done
npx tsx scripts/encrypt-bid.ts --pubkey "$PK" --slot 4 --bid 500 --salt 5 \
  | curl -s -H 'content-type: application/json' --data @- http://localhost:8080/bids

# 5. Seed the mock commitments file with the on-chain values you expect.
#    These must be Poseidon2(bid[i], salt[i]) for each slot.
#    The circuit test `test_print_hash_values` prints known hashes:
#      Poseidon2(100, 1)  = ...
#      Poseidon2(200, 2)  = ...
#      Poseidon2(300, 3)  = ...
#      Poseidon2(400, 4)  = ...
#      Poseidon2(500, 5)  = ...
cat > data/commitments.json <<EOF
{ "commitments": ["0x...", "0x...", "0x...", "0x...", "0x..."] }
EOF

# 6. Close the auction
curl -s -X POST http://localhost:8080/close | jq .
```

## End-to-end test

`backend/test/e2e.ts` drives the full pipeline in-process:

1. Creates an isolated `DATA_DIR` under `$TMPDIR/zkbid-e2e-*`
2. Seeds `commitments.json` with the real Poseidon2 hashes from `circuit/test-inputs/basic/Prover.toml`
3. Boots the Express app on a random port
4. Encrypts 5 bids with nacl and POSTs each to `/bids`
5. Calls `POST /close` — which shells out to `circuit/scripts/prove.sh` and runs **real** `nargo execute` + `bb prove`
6. Asserts `winnerIndex=4`, `secondPrice=400`, `publicInputs.length=7`, and a non-empty proof

Run:

```bash
npm run test:e2e
```

Requires `nargo` and `bb` on `PATH`. The whole run takes ~1 second on a dev machine.

The test covers four scenarios from `test/scenarios.ts`:

| scenario | purpose | expected winner | expected second price |
|---|---|---|---|
| `basic` | all 5 slots filled, distinct bids | slot 4 | 400 |
| `tied` | two slots tie for the top bid — lowest index wins | slot 0 | 500 |
| `single` | only one bid submitted; rest are zero-bid sentinels | slot 0 | 0 |
| `all-equal` | every slot bids the same value | slot 0 | 250 |

## On-chain verification (without Person 1's contracts)

The **`HonkVerifier` contract in `circuit/contracts/ZKVerifier.sol` is standalone** — it has no dependency on the auction contract Person 1 is building. It takes a proof + public inputs and returns `true`/`false`. That means you can deploy it yourself and verify proofs end-to-end today, even with no auction contract, no frontend, and no team.

Three scripts drive this:

| script | what it does |
|---|---|
| `npm run compile:verifier` | Compiles `ZKVerifier.sol` with `solc`. Fails loudly if the bytecode blows past EIP-170 (24,576 B) or if library linking is broken. No RPC needed. |
| `npm run deploy:verifier` | Deploys `ZKTranscriptLib`, links it into `HonkVerifier`, deploys `HonkVerifier`, writes the address to `data/verifier-address.json`. |
| `npm run verify:onchain -- --state` | Reads the last finalized proof from `data/state.json` and `eth_call`s `HonkVerifier.verify(proof, publicInputs)`. Prints `true` / `false` / revert. No gas spent. |

### Option A — local smoke test (fully self-contained)

Zero external infra. `test/onchain.ts` spawns a `hardhat node` in-process, deploys the verifier, proves + verifies all four scenarios, and tears down. This is the check you want before touching a real network.

```bash
npm run test:onchain
```

Expected tail:

```
  ok    basic  winner=4 secondPrice=400 -- verifier returned true
  ok    tied  winner=0 secondPrice=500 -- verifier returned true
  ok    single  winner=0 secondPrice=0 -- verifier returned true
  ok    all-equal  winner=0 secondPrice=250 -- verifier returned true
[onchain] 4/4 scenarios verified on-chain
[onchain] ALL CHECKS PASSED
```

If this passes, your proving pipeline, the generated Solidity verifier, and the deploy/link logic are all correct. The only unknowns left are network/RPC specifics.

### Option B — local Anvil / Hardhat node (manual, two terminals)

Useful when you want to play with the deployed contract from other tools (cast, ethers REPL, etc.) instead of just running the automated test.

```bash
# terminal 1: a local chain with funded test accounts
anvil                              # or: npx hardhat node

# terminal 2: deploy + run an auction
cd backend
cat >> .env <<'EOF'
RPC_URL=http://127.0.0.1:8545
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil acc #0
EOF

npm run compile:verifier      # sanity check
npm run deploy:verifier       # writes data/verifier-address.json

# run the auction (using the local flow above, or e2e.ts)
npm run test:e2e              # this finalizes and writes data/state.json

npm run verify:onchain -- --state   # → RESULT: true
```

### Option C — Sepolia (or any public testnet)

Exactly the same scripts, just a different RPC and a funded key. You do **not** need Person 1's auction contract — the verifier doesn't know or care about it.

1. Get a Sepolia RPC URL (Alchemy / Infura / public endpoint) and ~0.05 ETH of Sepolia test ETH on a throwaway key (`https://sepoliafaucet.com`, `https://sepolia-faucet.pk910.de`, etc.).

2. Fill in `.env`:

   ```
   RPC_URL=https://sepolia.infura.io/v3/<KEY>
   PRIVATE_KEY=0x<your-funded-throwaway-key>
   ```

   > The `HonkVerifier` deploy currently costs ~6–7M gas (one-time). Check the `[deploy]` log output once the transaction is mined.

3. Deploy:

   ```bash
   npm run deploy:verifier
   ```

   You'll get output like:

   ```
   [deploy] chain=11155111 deployer=0x... balance=0.05 ETH
   [deploy] library ZKTranscriptLib -> 0x...
   [deploy] HonkVerifier creation bytecode: 47.8 KiB
   [deploy] HonkVerifier @ 0xVERIFIER... (tx 0x...)
   [deploy] wrote .../data/verifier-address.json
   ```

4. Produce a proof. Either run the backend and the local flow from the previous section (using your real commitments), or just run `npm run test:e2e` once — it writes the most recent proof to `data/state.json`.

5. Verify on Sepolia:

   ```bash
   npm run verify:onchain -- --state
   ```

   `verify` is a `view` function, so this is a free `eth_call`, no signer / no second transaction needed:

   ```
   [verify] rpc=https://sepolia.infura.io/v3/<KEY>
   [verify] verifier=0xVERIFIER...
   [verify] proof length=14080 bytes
   [verify] publicInputs: 7 entries
   [verify] RESULT: true -- on-chain verifier accepted the proof
   ```

   You can also point `verify:onchain` at any other proof on disk:

   ```bash
   npm run verify:onchain -- --run path/to/zkbid-run-XXXX
   ```

### Why this is enough proof the system works

- The generated Solidity verifier is exactly what Person 1's auction contract will call in production — it's the same `HonkVerifier` from `circuit/contracts/ZKVerifier.sol`. If a proof verifies in isolation here, it'll verify from inside their contract too.
- On-chain `view` verification is a pure function of `(proof, publicInputs)`: no auction state, no commitments-storage contract, no access control. Anything you prove here is exactly what Person 1's contract will see.
- When Person 1 is ready, they consume the verifier either by (a) deploying it the same way and hardcoding the address, or (b) inheriting from `HonkVerifier` in `AuctionVerifier.sol`. Either way, your `data/verifier-address.json` and `data/state.json` are the handoff artifacts.

## What the backend expects from Person 1's contract

When `COMMITMENTS_SOURCE=ethers` is set, the backend expects the auction contract to expose:

```solidity
function getCommitments() external view returns (bytes32[] memory);
```

Length must be `NUM_SLOTS` (5). Slots that never received a bid must contain the zero-bid sentinel:

```
Poseidon2(0, 0) = 0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1
```

If Person 1 can't add that exact view, they can emit a `BidCommitted(uint8 slot, bytes32 commitment)` event and we'll swap `chain/commitments.ts` to read it.

## Threat model (short)

- The auctioneer is trusted for privacy (it sees all decrypted bids) and for liveness (it picks the winner), but **not** for correctness — the ZK proof ensures the contract only accepts a result consistent with the published commitments.
- Bidders gain confidentiality against everyone _except_ the auctioneer. This is inherent to a server-side decryption model.
- `data/auctioneer.key.json` is written `0600` and must be treated as a secret. If it leaks, historic auctions can be decrypted.
