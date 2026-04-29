import { ethers } from "ethers";

export function shortAddress(address?: string) {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function shortHash(value?: string) {
  if (!value) return "0x";
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export function formatEth(value: bigint | null | undefined, maxDecimals = 6) {
  if (value === null || value === undefined) return "-";
  const formatted = ethers.formatEther(value);
  const [whole, decimals = ""] = formatted.split(".");
  const trimmed = decimals.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed} ETH` : `${whole} ETH`;
}

export function formatDateTime(seconds: bigint) {
  if (seconds === 0n) return "-";
  const date = new Date(Number(seconds) * 1000);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function phaseLabel(id: number) {
  switch (id) {
    case 0:
      return "Open";
    case 1:
      return "Closed";
    case 2:
      return "Finalized";
    case 3:
      return "Cancelled";
    default:
      return `Unknown (${id})`;
  }
}

export function sameAddress(a?: string, b?: string) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}
