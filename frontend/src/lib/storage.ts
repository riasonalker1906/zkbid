import { PendingEncryptedBid } from "../types";

function key(auctionAddress: string, account: string) {
  return `zkbid:pending:${auctionAddress.toLowerCase()}:${account.toLowerCase()}`;
}

export function savePendingBid(payload: PendingEncryptedBid) {
  localStorage.setItem(key(payload.auctionAddress, payload.account), JSON.stringify(payload));
}

export function loadPendingBid(auctionAddress: string, account: string): PendingEncryptedBid | null {
  const raw = localStorage.getItem(key(auctionAddress, account));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingEncryptedBid;
  } catch {
    localStorage.removeItem(key(auctionAddress, account));
    return null;
  }
}

export function clearPendingBid(auctionAddress: string, account: string) {
  localStorage.removeItem(key(auctionAddress, account));
}
