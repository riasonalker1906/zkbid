import { BACKEND_URL } from "../config";
import { BackendBidEnvelope, BackendStatus, CloseResult, PubkeyResponse } from "../types";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BACKEND_URL) {
    throw new Error("VITE_BACKEND_URL is not configured.");
  }

  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = body?.message ?? body?.error ?? `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return body as T;
}

export function fetchPubkey() {
  return api<PubkeyResponse>("/pubkey");
}

export function fetchBackendStatus() {
  return api<BackendStatus>("/status");
}

export function postEncryptedBid(payload: BackendBidEnvelope) {
  return api<{ ok: boolean; slot: number; totalBids: number }>("/bids", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function closeAuction() {
  return api<CloseResult>("/close", {
    method: "POST",
    body: "{}",
  });
}
