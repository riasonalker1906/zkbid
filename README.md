# ZKBid

ZKBid is a zero-knowledge sealed-bid Vickrey auction on Ethereum. Bidders submit encrypted bids and public commitments. The auctioneer later proves the correct winner and second price with a zero-knowledge proof, without revealing the actual bid amounts.

## Repository Layout

```text
zkbid/
├── contracts/   Solidity AuctionManager contract and Hardhat deployment
├── circuit/     Noir circuit and generated HonkVerifier contract
├── backend/     Auctioneer API, bid decryption, and proof generation
└── frontend/    React/Vite app for bidders, auctioneer, and withdrawals
```

There is no root `package.json`. Run npm commands inside the specific folder: `contracts/`, `backend/`, `frontend/`, or `circuit/`.

## How It Works

Each bidder chooses a private bid and a private salt:

```text
commitment = Poseidon2(bid, salt)
```

The commitment is stored on-chain. The bid and salt are encrypted to the auctioneer backend.

When the auction closes, the backend decrypts the bids, computes the winner and second price, and generates a Noir/Barretenberg proof. The proof shows:

- every private bid and salt matches the on-chain commitment
- the declared winner is the highest bidder
- lowest slot index wins ties
- the declared second price is the highest non-winning bid

Only the winner index and second price become public. The highest bid amount is never revealed.

## Current Design Choices

- Payment token: native ETH. On Sepolia, this means Sepolia ETH.
- Bid slots: fixed at 5.
- Empty slots: `Poseidon2(0,0)`.
- Deadline: configurable per auction deployment.
- Seller: currently the deployer of `AuctionManager`.
- Auctioneer: address configured during `AuctionManager` deployment.
- Deposit: configured during deployment in wei.

The fixed 5-slot limit exists because the Solidity contract, Noir circuit, backend, and frontend must all agree with the proof shape.

## Main Contracts

`contracts/contracts/AuctionManager.sol` stores commitments, encrypted bid payloads, deposits, and final auction state.

Important calls:

```solidity
submitBid(slot, commitment, ephemeralPubkey, nonce, ciphertext)
finalize(winnerIndex, secondPrice, proof)
withdraw()
getCommitments()
```

`circuit/contracts/ZKVerifier.sol` contains the generated `HonkVerifier` contract used by `AuctionManager` to verify proofs.

## Environment Files

Create real `.env` files from the examples. The `.env.example` files are templates only.

Backend:

```bash
cd /Users/pgeesala/Desktop/zkbid/backend
cp .env.example .env
```

Contracts:

```bash
cd /Users/pgeesala/Desktop/zkbid/contracts
cp .env.example .env
```

Frontend:

```bash
cd /Users/pgeesala/Desktop/zkbid/frontend
cp .env.example .env.local
```

Never commit real private keys.

## Deployment Order

Deploy and connect the project in this order:

```text
1. Compile circuit
2. Deploy HonkVerifier
3. Deploy AuctionManager
4. Configure backend with AuctionManager address
5. Configure frontend with backend URL and AuctionManager address
6. Run bid/finalize/withdraw flow
```

## 1. Install Dependencies

Contracts:

```bash
cd /Users/pgeesala/Desktop/zkbid/contracts
npm install
```

Backend:

```bash
cd /Users/pgeesala/Desktop/zkbid/backend
npm install
```

Frontend:

```bash
cd /Users/pgeesala/Desktop/zkbid/frontend
npm install
```

The circuit needs `nargo` and `bb` installed. The current `circuit/package.json` contains an npm dependency that may not resolve, so circuit npm install is not required for normal Noir compilation.

## 2. Compile Circuit

```bash
cd /Users/pgeesala/Desktop/zkbid/circuit
nargo test --show-output
bash scripts/compile.sh
```

If `nargo` is not found, install Noir using `noirup`. If `bb` is not found, install Barretenberg using `bbup`.

## 3. Deploy HonkVerifier

Edit `backend/.env`:

```text
RPC_URL=<Sepolia RPC URL>
PRIVATE_KEY=<deployer private key>
```

Then run:

```bash
cd /Users/pgeesala/Desktop/zkbid/backend
npm run compile:verifier
npm run deploy:verifier
```

Save the deployed verifier address. It is also written to:

```text
backend/data/verifier-address.json
```

This address becomes:

```text
VERIFIER_ADDRESS=<HonkVerifier address>
```

## 4. Deploy AuctionManager

Choose the auctioneer wallet address. This is the wallet that will be allowed to finalize the auction.

Edit `contracts/.env`:

```text
SEPOLIA_RPC_URL=<Sepolia RPC URL>
PRIVATE_KEY=<seller/deployer private key>
ETHERSCAN_API_KEY=<optional>

VERIFIER_ADDRESS=<HonkVerifier address>
AUCTIONEER_ADDRESS=<auctioneer wallet address>
MIN_DEPOSIT_WEI=10000000000000000
COMMIT_DURATION_SECONDS=3600
```

Deploy:

```bash
cd /Users/pgeesala/Desktop/zkbid/contracts
npm run compile
npm run deploy:sepolia
```

Save the `auctionManager` address from:

```text
contracts/deployments/sepolia.json
```

## 5. Configure Backend

Edit `backend/.env`:

```text
PORT=8080
CIRCUIT_DIR=../circuit
DATA_DIR=./data
NUM_SLOTS=5
COMMITMENTS_SOURCE=ethers
RPC_URL=<Sepolia RPC URL>
AUCTION_ADDRESS=<AuctionManager address>
VERIFIER_ADDRESS=<HonkVerifier address>
```

Start backend:

```bash
cd /Users/pgeesala/Desktop/zkbid/backend
npm run dev
```

Check it:

```bash
curl http://localhost:8080/healthz
```

Expected:

```json
{"ok":true}
```

## 6. Configure Frontend

Edit `frontend/.env.local`:

```text
VITE_AUCTION_ADDRESS=<AuctionManager address>
VITE_BACKEND_URL=http://localhost:8080
VITE_SEPOLIA_CHAIN_ID=11155111
```

Start frontend:

```bash
cd /Users/pgeesala/Desktop/zkbid/frontend
npm run dev
```

Open the Vite URL, usually:

```text
http://localhost:5173
```

## Full Auction Flow

Bidder:

1. Open frontend.
2. Connect wallet on Sepolia.
3. Choose an empty slot.
4. Enter bid amount.
5. Submit encrypted bid.

The frontend sends the commitment to `AuctionManager` and sends the encrypted bid envelope to the backend.

Auctioneer:

1. Wait until the commit deadline passes.
2. Connect the configured `AUCTIONEER_ADDRESS` wallet.
3. Use the auctioneer tab to close/finalize.
4. The frontend calls backend `/close`.
5. Backend generates the proof.
6. Frontend submits `finalize(winnerIndex, secondPrice, proof)` on-chain.

Withdrawals:

1. Seller and bidders connect wallets after finalization.
2. Open withdraw tab.
3. Call `withdraw()`.

The seller receives the second price. Losing bidders receive full deposits. The winner receives deposit minus second price.

## Checks

Contracts:

```bash
cd /Users/pgeesala/Desktop/zkbid/contracts
npm test
```

Backend:

```bash
cd /Users/pgeesala/Desktop/zkbid/backend
npm run typecheck
npm run test:e2e
```

Frontend:

```bash
cd /Users/pgeesala/Desktop/zkbid/frontend
npm run typecheck
npm run build
```

## Common Issues

### npm install fails in repo root

Run npm commands inside a subfolder:

```bash
cd frontend
```

or:

```bash
cd backend
```

or:

```bash
cd contracts
```

### Missing RPC_URL

The scripts read `.env`, not `.env.example`.

Create the real file:

```bash
cd backend
cp .env.example .env
```

Then set:

```text
RPC_URL=<your RPC URL>
PRIVATE_KEY=<your private key>
```

### Failed to fetch in frontend

Check backend is running:

```bash
curl http://localhost:8080/healthz
```

Check `frontend/.env.local`:

```text
VITE_BACKEND_URL=http://localhost:8080
```

Restart frontend after changing `.env.local`.

### Bid must be less than or equal to the fixed deposit

The contract collects a fixed deposit. A bid cannot exceed the fixed deposit because the winner must be able to cover the second price.

If the deployed deposit is too small, redeploy `AuctionManager` with a larger value:

```text
MIN_DEPOSIT_WEI=10000000000000000
```

This example is `0.01 ETH`.

### Invalid proof during finalization

Check:

- backend `AUCTION_ADDRESS` matches frontend `VITE_AUCTION_ADDRESS`
- backend uses `COMMITMENTS_SOURCE=ethers`
- verifier address used during `AuctionManager` deployment is correct
- circuit was compiled
- `NUM_SLOTS=5` everywhere
- backend received every encrypted bid submitted on-chain

