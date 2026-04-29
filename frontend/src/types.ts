export type HexString = `0x${string}`;

export type PhaseId = 0 | 1 | 2 | 3;

export interface SlotState {
  index: number;
  filled: boolean;
  bidder: string;
  deposit: bigint;
  commitment: string;
}

export interface ChainSnapshot {
  phaseId: PhaseId;
  phaseLabel: string;
  commitDeadline: bigint;
  minDeposit: bigint;
  totalBids: bigint;
  seller: string;
  auctioneer: string;
  slots: SlotState[];
  pendingWithdrawal: bigint;
  winnerIndex: bigint | null;
  secondPrice: bigint | null;
}

export interface PubkeyResponse {
  scheme: string;
  curve: string;
  publicKey: string;
  numSlots: number;
}

export interface BackendBidEnvelope {
  slot: number;
  bidderAddress?: string;
  ephemeralPubkey: string;
  nonce: string;
  ciphertext: string;
}

export interface BackendStatus {
  phase: string;
  numSlots: number;
  submittedSlots: number[];
  commitmentsSource: "mock" | "ethers";
  result: CloseResult | null;
  lastError: string | null;
}

export interface CloseResult {
  ok?: boolean;
  alreadyFinalized?: boolean;
  winnerIndex: number;
  secondPrice: string;
  commitments?: string[];
  publicInputs?: string[];
  proof?: HexString;
  proofHex?: HexString;
  finalizedAt?: string;
  result?: CloseResult;
}

export interface PendingEncryptedBid {
  auctionAddress: string;
  account: string;
  slot: number;
  commitment: HexString;
  backendPayload: BackendBidEnvelope;
  txHash: HexString;
  createdAt: string;
}
