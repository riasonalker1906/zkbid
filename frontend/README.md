# ZKBid Frontend

Vite React demo app for the Sepolia sealed-bid auction.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Required environment:

```text
VITE_AUCTION_ADDRESS=<AuctionManager address>
VITE_BACKEND_URL=<public auctioneer backend URL>
VITE_SEPOLIA_CHAIN_ID=11155111
```

The frontend is static and can be deployed from this `frontend/` directory on Vercel. The auctioneer backend must run separately because proof generation shells out to Noir/Barretenberg.

## Checks

```bash
npm run typecheck
npm run test:run
npm run build
```
