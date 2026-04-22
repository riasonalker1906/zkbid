# ZKBid — Zero-Knowledge Sealed-Bid Auction

A Vickrey (second-price) auction on Ethereum where **bid amounts are never revealed** — not during the auction, not after. The auctioneer proves the result is correct using a zero-knowledge proof.

> This repo is split by team member. Each person works in their own folder and hands off artifacts to the others.

---

## Repository Layout

```
zkbid/
├── circuit/          ← Person 2 (this folder) — ZK circuit in Noir
├── contracts/        ← Person 1 — Solidity smart contracts (Hardhat)
├── frontend/         ← Person 3 — React frontend
└── backend/          ← Person 4 — Auctioneer proof-generation script
```

---

## How It Works (Big Picture)

1. **Bidders** encrypt their bid with the auctioneer's public key and submit it on-chain. The bid amount is never visible.
2. **The auctioneer** decrypts all bids privately, picks the winner (highest bid, lowest index breaks ties), and generates a ZK proof.
3. **The proof** says: "I know bid amounts that match the on-chain commitments, and these amounts make this winner and second price correct." The actual amounts stay private.
4. **The smart contract** verifies the proof on-chain. If it's valid, the winner pays the second price. No one can cheat.

---
