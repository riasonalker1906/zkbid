import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const ZERO_BID_COMMITMENT =
  "0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1";

const BASIC_COMMITMENTS = [
  "0x0b9ad17d3d4fb2312e03a54420f18a745b0fac191ba33336e12dd566ec5a0756",
  "0x27f17d88420e8006ecaba663ebc0bbaccd7aaa60e22f6a6f97a05270124a1f46",
  "0x1c6fbea11355a1cb48a260349444417ce4db7c7cd34ab7f0025fbba605ccb12c",
  "0x1a6b7105ff9260f558b7d32dd3350dbda162bf75aa8075ab3700339206b9c669",
  "0x09cbc236f417b4e7b85d6b7d4668c7ddd710f39a519df883b0f322d1d3facb1d"
];

function b32(value: bigint | number): string {
  return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

describe("AuctionManager", function () {
  async function deployFixture() {
    const [seller, auctioneer, bidder0, bidder1, bidder2, bidder3, bidder4, stranger] =
      await ethers.getSigners();

    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    const verifier = await MockVerifier.deploy();
    await verifier.waitForDeployment();

    const minDeposit = ethers.parseEther("1");
    const AuctionManager = await ethers.getContractFactory("AuctionManager");
    const auction = await AuctionManager.deploy(
      await verifier.getAddress(),
      seller.address,
      auctioneer.address,
      3600,
      minDeposit
    );
    await auction.waitForDeployment();

    return {
      auction,
      verifier,
      seller,
      auctioneer,
      bidders: [bidder0, bidder1, bidder2, bidder3, bidder4],
      stranger,
      minDeposit
    };
  }

  async function submitBasicBids() {
    const ctx = await deployFixture();
    for (let i = 0; i < BASIC_COMMITMENTS.length; i++) {
      await ctx.auction
        .connect(ctx.bidders[i])
        .submitBid(i, BASIC_COMMITMENTS[i], "0x1234", "0xabcd", "0xfeed", {
          value: ethers.parseEther("10")
        });
    }
    return ctx;
  }

  it("initializes empty slots with the zero-bid sentinel", async function () {
    const { auction } = await deployFixture();
    expect(await auction.getCommitments()).to.deep.equal(Array(5).fill(ZERO_BID_COMMITMENT));
  });

  it("stores commitments and encrypted bid payloads", async function () {
    const { auction, bidders, minDeposit } = await deployFixture();

    await expect(
      auction
        .connect(bidders[0])
        .submitBid(0, BASIC_COMMITMENTS[0], "0x1234", "0xabcd", "0xfeed", { value: minDeposit })
    )
      .to.emit(auction, "BidCommitted")
      .withArgs(0, bidders[0].address, BASIC_COMMITMENTS[0], "0x1234", "0xabcd", "0xfeed", minDeposit);

    expect(await auction.getCommitments()).to.deep.equal([
      BASIC_COMMITMENTS[0],
      ZERO_BID_COMMITMENT,
      ZERO_BID_COMMITMENT,
      ZERO_BID_COMMITMENT,
      ZERO_BID_COMMITMENT
    ]);

    const encrypted = await auction.getEncryptedBid(0);
    expect(encrypted.ephemeralPubkey).to.equal("0x1234");
    expect(encrypted.nonce).to.equal("0xabcd");
    expect(encrypted.ciphertext).to.equal("0xfeed");
  });

  it("rejects duplicate slots, invalid slots, small deposits, and empty encrypted payloads", async function () {
    const { auction, bidders, minDeposit } = await deployFixture();

    await expect(
      auction
        .connect(bidders[0])
        .submitBid(5, BASIC_COMMITMENTS[0], "0x1234", "0xabcd", "0xfeed", { value: minDeposit })
    ).to.be.revertedWithCustomError(auction, "InvalidSlot");

    await expect(
      auction
        .connect(bidders[0])
        .submitBid(0, BASIC_COMMITMENTS[0], "0x1234", "0xabcd", "0xfeed", {
          value: minDeposit - 1n
        })
    ).to.be.revertedWithCustomError(auction, "DepositTooSmall");

    await expect(
      auction
        .connect(bidders[0])
        .submitBid(0, BASIC_COMMITMENTS[0], "0x", "0xabcd", "0xfeed", { value: minDeposit })
    ).to.be.revertedWithCustomError(auction, "EmptyEncryptedBid");

    await auction
      .connect(bidders[0])
      .submitBid(0, BASIC_COMMITMENTS[0], "0x1234", "0xabcd", "0xfeed", { value: minDeposit });

    await expect(
      auction
        .connect(bidders[1])
        .submitBid(0, BASIC_COMMITMENTS[1], "0x1234", "0xabcd", "0xfeed", { value: minDeposit })
    ).to.be.revertedWithCustomError(auction, "SlotAlreadyFilled");
  });

  it("rejects bids after the commit deadline", async function () {
    const { auction, bidders, minDeposit } = await deployFixture();
    await time.increase(3600);

    await expect(
      auction
        .connect(bidders[0])
        .submitBid(0, BASIC_COMMITMENTS[0], "0x1234", "0xabcd", "0xfeed", { value: minDeposit })
    ).to.be.revertedWithCustomError(auction, "CommitPhaseEnded");
  });

  it("rejects finalization before the deadline and from non-auctioneer accounts", async function () {
    const { auction, auctioneer, stranger } = await submitBasicBids();

    await expect(
      auction.connect(auctioneer).finalize(4, 400, "0x1234")
    ).to.be.revertedWithCustomError(auction, "InvalidPhase");

    await time.increase(3600);

    await expect(
      auction.connect(stranger).finalize(4, 400, "0x1234")
    ).to.be.revertedWithCustomError(auction, "Unauthorized");
  });

  it("constructs verifier public inputs from on-chain commitments", async function () {
    const { auction, verifier, auctioneer } = await submitBasicBids();
    await time.increase(3600);

    const expected = [...BASIC_COMMITMENTS, b32(4), b32(400)];
    await verifier.setExpectedInputs(expected);

    await expect(auction.connect(auctioneer).finalize(4, 400, "0x1234"))
      .to.emit(auction, "AuctionFinalized")
      .withArgs(4, await auction.bidders(4), 400);

    expect(await auction.winnerIndex()).to.equal(4);
    expect(await auction.secondPrice()).to.equal(400);
  });

  it("rejects invalid proofs", async function () {
    const { auction, verifier, auctioneer } = await submitBasicBids();
    await time.increase(3600);
    await verifier.setResult(false);

    await expect(
      auction.connect(auctioneer).finalize(4, 400, "0x1234")
    ).to.be.revertedWithCustomError(auction, "InvalidProof");
  });

  it("rejects under-collateralized second prices", async function () {
    const { auction, auctioneer } = await submitBasicBids();
    await time.increase(3600);

    await expect(
      auction.connect(auctioneer).finalize(4, ethers.parseEther("11"), "0x1234")
    ).to.be.revertedWithCustomError(auction, "InvalidSecondPrice");
  });

  it("credits seller payment, winner refund, and non-winner refunds", async function () {
    const { auction, auctioneer, seller, bidders } = await submitBasicBids();
    await time.increase(3600);

    const secondPrice = ethers.parseEther("4");
    await auction.connect(auctioneer).finalize(4, secondPrice, "0x1234");

    expect(await auction.pendingWithdrawals(seller.address)).to.equal(secondPrice);
    expect(await auction.pendingWithdrawals(bidders[4].address)).to.equal(ethers.parseEther("6"));
    for (let i = 0; i < 4; i++) {
      expect(await auction.pendingWithdrawals(bidders[i].address)).to.equal(ethers.parseEther("10"));
    }

    await expect(() => auction.connect(seller).withdraw()).to.changeEtherBalance(seller, secondPrice);
    await expect(auction.connect(seller).withdraw()).to.be.revertedWithCustomError(
      auction,
      "NothingToWithdraw"
    );
  });

  it("allows seller cancellation before finalization and refunds bidders", async function () {
    const { auction, seller, bidders, minDeposit } = await deployFixture();
    await auction
      .connect(bidders[0])
      .submitBid(0, BASIC_COMMITMENTS[0], "0x1234", "0xabcd", "0xfeed", { value: minDeposit });

    await expect(auction.connect(seller).cancel()).to.emit(auction, "AuctionCancelled");
    expect(await auction.pendingWithdrawals(bidders[0].address)).to.equal(minDeposit);
  });
});
