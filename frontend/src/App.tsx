import {
  BadgeCheck,
  CircleDollarSign,
  Clock,
  Coins,
  ExternalLink,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Send,
  ShieldCheck,
  Unplug,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ethers } from "ethers";
import { AUCTION_ADDRESS, BACKEND_URL, MAX_U64, NUM_SLOTS, SEPOLIA_CHAIN_ID } from "./config";
import { closeAuction, fetchBackendStatus, fetchPubkey, postEncryptedBid } from "./lib/backend";
import { computeBidCommitment, randomFieldElement, sealBid } from "./lib/crypto";
import {
  connectAccounts,
  getChainId,
  getWriteContract,
  hasWallet,
  isSepolia,
  loadSnapshot,
  switchToSepolia,
} from "./lib/ethereum";
import { formatDateTime, formatEth, sameAddress, shortAddress, shortHash } from "./lib/format";
import { clearPendingBid, loadPendingBid, savePendingBid } from "./lib/storage";
import { BackendStatus, ChainSnapshot, CloseResult, PendingEncryptedBid } from "./types";

type Tab = "bidder" | "auctioneer" | "withdraw";
type NoticeKind = "idle" | "info" | "success" | "error";

interface Notice {
  kind: NoticeKind;
  text: string;
}

const DEFAULT_NOTICE: Notice = { kind: "idle", text: "" };

export default function App() {
  const [account, setAccount] = useState<string>("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<ChainSnapshot | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [pendingBid, setPendingBid] = useState<PendingEncryptedBid | null>(null);
  const [tab, setTab] = useState<Tab>("bidder");
  const [slot, setSlot] = useState("0");
  const [bidEth, setBidEth] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<Notice>(DEFAULT_NOTICE);
  const [lastCloseResult, setLastCloseResult] = useState<CloseResult | null>(null);

  const walletAvailable = hasWallet();
  const correctNetwork = isSepolia(chainId);
  const appConfigured = Boolean(AUCTION_ADDRESS && BACKEND_URL);
  const isAuctioneer = sameAddress(account, snapshot?.auctioneer);
  const isSeller = sameAddress(account, snapshot?.seller);

  const openSlots = useMemo(() => snapshot?.slots.filter((item) => !item.filled) ?? [], [snapshot]);

  const refreshAll = useCallback(async () => {
    if (!walletAvailable || !AUCTION_ADDRESS) return;

    try {
      const [nextChainId, nextSnapshot, nextBackendStatus] = await Promise.all([
        getChainId(),
        loadSnapshot(account || undefined),
        BACKEND_URL ? fetchBackendStatus().catch(() => null) : Promise.resolve(null),
      ]);
      setChainId(nextChainId);
      setSnapshot(nextSnapshot);
      if (nextBackendStatus) setBackendStatus(nextBackendStatus);
      if (account) setPendingBid(loadPendingBid(AUCTION_ADDRESS, account));
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    }
  }, [account, walletAvailable]);

  useEffect(() => {
    refreshAll();
    const id = window.setInterval(refreshAll, 15000);
    return () => window.clearInterval(id);
  }, [refreshAll]);

  useEffect(() => {
    if (!window.ethereum) return;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = (args[0] as string[]) ?? [];
      const next = accounts[0] ?? "";
      setAccount(next);
      setPendingBid(next && AUCTION_ADDRESS ? loadPendingBid(AUCTION_ADDRESS, next) : null);
    };
    const onChainChanged = () => {
      void refreshAll();
    };
    window.ethereum.on?.("accountsChanged", onAccountsChanged);
    window.ethereum.on?.("chainChanged", onChainChanged);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", onChainChanged);
    };
  }, [refreshAll]);

  async function connectWallet() {
    setBusy("connect");
    setNotice(DEFAULT_NOTICE);
    try {
      const accounts = await connectAccounts();
      setAccount(accounts[0] ?? "");
      setChainId(await getChainId());
      await refreshAll();
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  async function submitBid(event: FormEvent) {
    event.preventDefault();
    if (!account) return setNotice({ kind: "error", text: "Connect a wallet first." });
    if (!snapshot) return setNotice({ kind: "error", text: "Auction data is not loaded." });
    if (!correctNetwork) return setNotice({ kind: "error", text: "Switch to Sepolia first." });

    setBusy("bid");
    setNotice({ kind: "info", text: "Preparing encrypted bid..." });

    try {
      const selectedSlot = Number(slot);
      if (!Number.isInteger(selectedSlot) || selectedSlot < 0 || selectedSlot >= NUM_SLOTS) {
        throw new Error("Choose a valid slot.");
      }
      if (snapshot.slots[selectedSlot]?.filled) throw new Error(`Slot ${selectedSlot} is already filled.`);

      const bidWei = ethers.parseEther(bidEth || "0");
      if (bidWei <= 0n) throw new Error("Bid must be greater than zero.");
      if (bidWei > MAX_U64) throw new Error("Bid must fit in uint64.");
      if (bidWei > snapshot.minDeposit) {
        throw new Error("Bid must be less than or equal to the fixed deposit.");
      }

      const pubkey = await fetchPubkey();
      const salt = randomFieldElement();
      const commitment = await computeBidCommitment(bidWei, salt);
      const sealed = sealBid({
        slot: selectedSlot,
        bidWei,
        salt,
        auctioneerPublicKeyBase64: pubkey.publicKey,
        bidderAddress: account,
      });

      setNotice({ kind: "info", text: "Submitting commitment on-chain..." });
      const contract = await getWriteContract();
      const tx = await contract.submitBid(
        selectedSlot,
        commitment,
        sealed.contractPayload.ephemeralPubkey,
        sealed.contractPayload.nonce,
        sealed.contractPayload.ciphertext,
        { value: snapshot.minDeposit },
      );
      const receipt = await tx.wait();

      const retryPayload: PendingEncryptedBid = {
        auctionAddress: AUCTION_ADDRESS,
        account,
        slot: selectedSlot,
        commitment,
        backendPayload: sealed.backendPayload,
        txHash: receipt?.hash ?? tx.hash,
        createdAt: new Date().toISOString(),
      };
      savePendingBid(retryPayload);
      setPendingBid(retryPayload);

      setNotice({ kind: "info", text: "Forwarding encrypted envelope to auctioneer backend..." });
      await postEncryptedBid(sealed.backendPayload);
      clearPendingBid(AUCTION_ADDRESS, account);
      setPendingBid(null);
      setBidEth("");
      setNotice({ kind: "success", text: "Encrypted bid submitted." });
      await refreshAll();
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  async function retryBackendPost() {
    if (!pendingBid || !account) return;
    setBusy("retry");
    setNotice({ kind: "info", text: "Retrying backend submission..." });
    try {
      await postEncryptedBid(pendingBid.backendPayload);
      clearPendingBid(AUCTION_ADDRESS, account);
      setPendingBid(null);
      setNotice({ kind: "success", text: "Backend accepted the encrypted envelope." });
      await refreshAll();
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  async function closeAndFinalize() {
    if (!account) return setNotice({ kind: "error", text: "Connect the auctioneer wallet first." });
    if (!isAuctioneer) return setNotice({ kind: "error", text: "Connected wallet is not the auctioneer." });
    if (!correctNetwork) return setNotice({ kind: "error", text: "Switch to Sepolia first." });

    setBusy("close");
    setNotice({ kind: "info", text: "Generating proof through auctioneer backend..." });
    try {
      const closeResult = await closeAuction();
      const result = closeResult.result ?? closeResult;
      const proof = result.proof ?? result.proofHex;
      setLastCloseResult({ ...result, proof });

      if (!proof) throw new Error("Backend did not return proof bytes.");
      setNotice({ kind: "info", text: "Submitting verified result on-chain..." });
      const contract = await getWriteContract();
      const tx = await contract.finalize(result.winnerIndex, BigInt(result.secondPrice), proof);
      await tx.wait();
      setNotice({ kind: "success", text: "Auction finalized on-chain." });
      await refreshAll();
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  async function withdraw() {
    if (!account) return setNotice({ kind: "error", text: "Connect a wallet first." });
    setBusy("withdraw");
    setNotice({ kind: "info", text: "Submitting withdrawal..." });
    try {
      const contract = await getWriteContract();
      const tx = await contract.withdraw();
      await tx.wait();
      setNotice({ kind: "success", text: "Withdrawal complete." });
      await refreshAll();
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand">
            <ShieldCheck size={28} />
            <span>ZKBid</span>
          </div>
          <p className="subtitle">Sepolia sealed-bid auction</p>
        </div>
        <div className="walletCluster">
          {chainId !== null && (
            <span className={correctNetwork ? "pill ok" : "pill warn"}>
              {correctNetwork ? "Sepolia" : `Chain ${chainId}`}
            </span>
          )}
          {account ? (
            <button className="iconButton secondary" onClick={() => setAccount("")} title="Disconnect">
              <Unplug size={18} />
              {shortAddress(account)}
            </button>
          ) : (
            <button className="iconButton primary" onClick={connectWallet} disabled={!walletAvailable || busy === "connect"}>
              {busy === "connect" ? <Loader2 className="spin" size={18} /> : <Wallet size={18} />}
              Connect
            </button>
          )}
        </div>
      </header>

      {!appConfigured && (
        <section className="notice error">
          Set VITE_AUCTION_ADDRESS and VITE_BACKEND_URL before running the demo.
        </section>
      )}

      {walletAvailable && !correctNetwork && account && (
        <section className="notice warn">
          <span>Sepolia required.</span>
          <button className="textButton" onClick={switchToSepolia}>
            Switch network
          </button>
        </section>
      )}

      {!walletAvailable && <section className="notice error">Install a wallet to run the auction demo.</section>}

      {notice.kind !== "idle" && <section className={`notice ${notice.kind}`}>{notice.text}</section>}

      <main className="content">
        <section className="statusBand">
          <StatusMetric icon={<Clock size={18} />} label="Phase" value={snapshot?.phaseLabel ?? "-"} />
          <StatusMetric icon={<KeyRound size={18} />} label="Deadline" value={snapshot ? formatDateTime(snapshot.commitDeadline) : "-"} />
          <StatusMetric icon={<Coins size={18} />} label="Deposit" value={formatEth(snapshot?.minDeposit)} />
          <StatusMetric icon={<LockKeyhole size={18} />} label="Bids" value={`${snapshot?.totalBids ?? 0n}/${NUM_SLOTS}`} />
          <button className="refreshButton" onClick={refreshAll} title="Refresh">
            <RefreshCw size={18} />
          </button>
        </section>

        <section className="layout">
          <aside className="panel">
            <h2>Auction</h2>
            <dl className="details">
              <div>
                <dt>Contract</dt>
                <dd>{AUCTION_ADDRESS ? shortAddress(AUCTION_ADDRESS) : "-"}</dd>
              </div>
              <div>
                <dt>Seller</dt>
                <dd>{shortAddress(snapshot?.seller)}</dd>
              </div>
              <div>
                <dt>Auctioneer</dt>
                <dd>{shortAddress(snapshot?.auctioneer)}</dd>
              </div>
              <div>
                <dt>Your role</dt>
                <dd>{isAuctioneer ? "Auctioneer" : isSeller ? "Seller" : account ? "Bidder" : "-"}</dd>
              </div>
            </dl>

            {snapshot?.phaseId === 2 && (
              <div className="resultBox">
                <BadgeCheck size={20} />
                <div>
                  <strong>Winner slot {snapshot.winnerIndex?.toString()}</strong>
                  <span>{formatEth(snapshot.secondPrice)} second price</span>
                </div>
              </div>
            )}

            <div className="slotGrid">
              {snapshot?.slots.map((item) => (
                <div className={`slot ${item.filled ? "filled" : ""}`} key={item.index}>
                  <span>Slot {item.index}</span>
                  <strong>{item.filled ? shortAddress(item.bidder) : "Open"}</strong>
                  <small>{shortHash(item.commitment)}</small>
                </div>
              ))}
            </div>
          </aside>

          <section className="workspace">
            <nav className="tabs">
              <button className={tab === "bidder" ? "active" : ""} onClick={() => setTab("bidder")}>
                Bidder
              </button>
              <button className={tab === "auctioneer" ? "active" : ""} onClick={() => setTab("auctioneer")}>
                Auctioneer
              </button>
              <button className={tab === "withdraw" ? "active" : ""} onClick={() => setTab("withdraw")}>
                Withdraw
              </button>
            </nav>

            {tab === "bidder" && (
              <BidderPanel
                bidEth={bidEth}
                busy={busy}
                minDeposit={snapshot?.minDeposit ?? 0n}
                openSlots={openSlots.map((item) => item.index)}
                pendingBid={pendingBid}
                selectedSlot={slot}
                setBidEth={setBidEth}
                setSlot={setSlot}
                submitBid={submitBid}
                retryBackendPost={retryBackendPost}
              />
            )}

            {tab === "auctioneer" && (
              <AuctioneerPanel
                backendStatus={backendStatus}
                busy={busy}
                closeAndFinalize={closeAndFinalize}
                isAuctioneer={isAuctioneer}
                lastCloseResult={lastCloseResult}
              />
            )}

            {tab === "withdraw" && (
              <WithdrawPanel
                busy={busy}
                pendingWithdrawal={snapshot?.pendingWithdrawal ?? 0n}
                withdraw={withdraw}
              />
            )}
          </section>
        </section>
      </main>
    </div>
  );
}

function StatusMetric(props: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      {props.icon}
      <div>
        <span>{props.label}</span>
        <strong>{props.value}</strong>
      </div>
    </div>
  );
}

function BidderPanel(props: {
  bidEth: string;
  busy: string;
  minDeposit: bigint;
  openSlots: number[];
  pendingBid: PendingEncryptedBid | null;
  selectedSlot: string;
  setBidEth: (value: string) => void;
  setSlot: (value: string) => void;
  submitBid: (event: FormEvent) => void;
  retryBackendPost: () => void;
}) {
  return (
    <div className="panel workPanel">
      <div className="panelTitle">
        <h2>Bidder</h2>
        <span className="pill">Fixed deposit {formatEth(props.minDeposit)}</span>
      </div>
      <form className="form" onSubmit={props.submitBid}>
        <label>
          <span>Slot</span>
          <select value={props.selectedSlot} onChange={(event) => props.setSlot(event.target.value)}>
            {Array.from({ length: NUM_SLOTS }, (_, index) => (
              <option key={index} value={index} disabled={!props.openSlots.includes(index)}>
                Slot {index}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Bid</span>
          <div className="inputSuffix">
            <input
              inputMode="decimal"
              min="0"
              placeholder="0.25"
              step="0.000000000000000001"
              value={props.bidEth}
              onChange={(event) => props.setBidEth(event.target.value)}
            />
            <span>ETH</span>
          </div>
        </label>
        <button className="iconButton primary" disabled={props.busy === "bid"}>
          {props.busy === "bid" ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
          Submit encrypted bid
        </button>
      </form>

      {props.pendingBid && (
        <div className="retryBox">
          <div>
            <strong>Backend retry pending</strong>
            <span>Slot {props.pendingBid.slot} from tx {shortHash(props.pendingBid.txHash)}</span>
          </div>
          <button className="iconButton secondary" onClick={props.retryBackendPost} disabled={props.busy === "retry"}>
            {props.busy === "retry" ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function AuctioneerPanel(props: {
  backendStatus: BackendStatus | null;
  busy: string;
  closeAndFinalize: () => void;
  isAuctioneer: boolean;
  lastCloseResult: CloseResult | null;
}) {
  return (
    <div className="panel workPanel">
      <div className="panelTitle">
        <h2>Auctioneer</h2>
        <span className={props.isAuctioneer ? "pill ok" : "pill warn"}>
          {props.isAuctioneer ? "Wallet matched" : "Auctioneer wallet required"}
        </span>
      </div>
      <dl className="details compact">
        <div>
          <dt>Backend phase</dt>
          <dd>{props.backendStatus?.phase ?? "-"}</dd>
        </div>
        <div>
          <dt>Submitted slots</dt>
          <dd>{props.backendStatus?.submittedSlots?.join(", ") || "-"}</dd>
        </div>
        <div>
          <dt>Commitments</dt>
          <dd>{props.backendStatus?.commitmentsSource ?? "-"}</dd>
        </div>
      </dl>
      {props.backendStatus?.lastError && <div className="notice error">{props.backendStatus.lastError}</div>}
      <button
        className="iconButton primary wide"
        disabled={!props.isAuctioneer || props.busy === "close"}
        onClick={props.closeAndFinalize}
      >
        {props.busy === "close" ? <Loader2 className="spin" size={18} /> : <ShieldCheck size={18} />}
        Close and finalize
      </button>
      {props.lastCloseResult && (
        <div className="proofBox">
          <span>Winner slot {props.lastCloseResult.winnerIndex}</span>
          <span>Second price {formatEth(BigInt(props.lastCloseResult.secondPrice))}</span>
          {props.lastCloseResult.proof && <small>Proof {shortHash(props.lastCloseResult.proof)}</small>}
        </div>
      )}
    </div>
  );
}

function WithdrawPanel(props: { busy: string; pendingWithdrawal: bigint; withdraw: () => void }) {
  return (
    <div className="panel workPanel withdrawPanel">
      <CircleDollarSign size={42} />
      <h2>Withdraw</h2>
      <strong>{formatEth(props.pendingWithdrawal)}</strong>
      <button
        className="iconButton primary"
        disabled={props.pendingWithdrawal === 0n || props.busy === "withdraw"}
        onClick={props.withdraw}
      >
        {props.busy === "withdraw" ? <Loader2 className="spin" size={18} /> : <ExternalLink size={18} />}
        Withdraw
      </button>
    </div>
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
