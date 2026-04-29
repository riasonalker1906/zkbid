import { BrowserProvider, Contract, ethers } from "ethers";
import { AUCTION_ABI } from "../abi";
import { AUCTION_ADDRESS, NUM_SLOTS, SEPOLIA_CHAIN_ID, SEPOLIA_CHAIN_ID_HEX } from "../config";
import { ChainSnapshot, PhaseId } from "../types";
import { phaseLabel } from "./format";

export function hasWallet() {
  return Boolean(window.ethereum);
}

export async function getProvider() {
  if (!window.ethereum) throw new Error("No injected wallet found.");
  return new BrowserProvider(window.ethereum);
}

export async function connectAccounts() {
  if (!window.ethereum) throw new Error("No injected wallet found.");
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  return accounts;
}

export async function switchToSepolia() {
  if (!window.ethereum) throw new Error("No injected wallet found.");
  await window.ethereum.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
  });
}

export async function getChainId() {
  const provider = await getProvider();
  const network = await provider.getNetwork();
  return Number(network.chainId);
}

export async function getReadContract() {
  if (!ethers.isAddress(AUCTION_ADDRESS)) {
    throw new Error("VITE_AUCTION_ADDRESS is not configured.");
  }
  const provider = await getProvider();
  return new Contract(AUCTION_ADDRESS, AUCTION_ABI, provider);
}

export async function getWriteContract() {
  if (!ethers.isAddress(AUCTION_ADDRESS)) {
    throw new Error("VITE_AUCTION_ADDRESS is not configured.");
  }
  const provider = await getProvider();
  const signer = await provider.getSigner();
  return new Contract(AUCTION_ADDRESS, AUCTION_ABI, signer);
}

export async function loadSnapshot(account?: string): Promise<ChainSnapshot> {
  const contract = await getReadContract();
  const [
    phaseIdRaw,
    commitDeadline,
    minDeposit,
    totalBids,
    seller,
    auctioneer,
    commitments,
  ] = await Promise.all([
    contract.phase(),
    contract.commitDeadline(),
    contract.minDeposit(),
    contract.totalBids(),
    contract.seller(),
    contract.auctioneer(),
    contract.getCommitments(),
  ]);

  const phaseId = Number(phaseIdRaw) as PhaseId;
  const slots = await Promise.all(
    Array.from({ length: NUM_SLOTS }, async (_, index) => {
      const [filled, bidder, deposit] = await Promise.all([
        contract.slotFilled(index),
        contract.bidders(index),
        contract.deposits(index),
      ]);
      return {
        index,
        filled: Boolean(filled),
        bidder: String(bidder),
        deposit: BigInt(deposit),
        commitment: String(commitments[index]),
      };
    }),
  );

  const pendingWithdrawal =
    account && ethers.isAddress(account) ? BigInt(await contract.pendingWithdrawals(account)) : 0n;

  const finalized = phaseId === 2;
  const [winnerIndex, secondPrice] = finalized
    ? await Promise.all([contract.winnerIndex(), contract.secondPrice()])
    : [null, null];

  return {
    phaseId,
    phaseLabel: phaseLabel(phaseId),
    commitDeadline: BigInt(commitDeadline),
    minDeposit: BigInt(minDeposit),
    totalBids: BigInt(totalBids),
    seller,
    auctioneer,
    slots,
    pendingWithdrawal,
    winnerIndex: winnerIndex === null ? null : BigInt(winnerIndex),
    secondPrice: secondPrice === null ? null : BigInt(secondPrice),
  };
}

export function isSepolia(chainId: number | null) {
  return chainId === SEPOLIA_CHAIN_ID;
}
