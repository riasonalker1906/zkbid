export const AUCTION_ADDRESS = (import.meta.env.VITE_AUCTION_ADDRESS ?? "").trim();
export const BACKEND_URL = stripTrailingSlash((import.meta.env.VITE_BACKEND_URL ?? "").trim());
export const SEPOLIA_CHAIN_ID = Number(import.meta.env.VITE_SEPOLIA_CHAIN_ID ?? "11155111");
export const SEPOLIA_CHAIN_ID_HEX = `0x${SEPOLIA_CHAIN_ID.toString(16)}`;

export const NUM_SLOTS = 5;
export const ZERO_BID_COMMITMENT =
  "0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1";
export const MAX_U64 = (1n << 64n) - 1n;
export const BN254_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function stripTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
