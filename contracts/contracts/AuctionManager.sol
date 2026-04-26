// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

contract AuctionManager {
    uint256 public constant NUM_SLOTS = 5;
    uint256 public constant PUBLIC_INPUT_COUNT = 7;
    uint256 public constant MAX_U64 = type(uint64).max;
    bytes32 public constant ZERO_BID_COMMITMENT =
        0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1;

    enum Phase {
        Open,
        Closed,
        Finalized,
        Cancelled
    }

    struct EncryptedBid {
        bytes ephemeralPubkey;
        bytes nonce;
        bytes ciphertext;
    }

    IHonkVerifier public immutable verifier;
    address public immutable seller;
    address public immutable auctioneer;
    uint64 public immutable commitDeadline;
    uint256 public immutable minDeposit;

    Phase private _phase;
    bytes32[NUM_SLOTS] private _commitments;
    EncryptedBid[NUM_SLOTS] private _encryptedBids;

    address[NUM_SLOTS] public bidders;
    uint256[NUM_SLOTS] public deposits;
    bool[NUM_SLOTS] public slotFilled;

    uint256 public totalBids;
    uint256 public winnerIndex;
    uint256 public secondPrice;

    mapping(address => uint256) public pendingWithdrawals;

    event AuctionCreated(
        address indexed seller,
        address indexed auctioneer,
        address indexed verifier,
        uint64 commitDeadline,
        uint256 minDeposit
    );
    event BidCommitted(
        uint256 indexed slot,
        address indexed bidder,
        bytes32 commitment,
        bytes ephemeralPubkey,
        bytes nonce,
        bytes ciphertext,
        uint256 deposit
    );
    event AuctionClosed();
    event AuctionFinalized(uint256 indexed winnerIndex, address indexed winner, uint256 secondPrice);
    event Withdrawal(address indexed account, uint256 amount);
    event AuctionCancelled();

    error ZeroAddress();
    error InvalidDuration();
    error InvalidSlot();
    error InvalidPhase();
    error CommitPhaseEnded();
    error CommitPhaseStillOpen();
    error SlotAlreadyFilled();
    error DepositTooSmall();
    error EmptyEncryptedBid();
    error NoBids();
    error Unauthorized();
    error InvalidWinner();
    error InvalidSecondPrice();
    error InvalidProof();
    error NothingToWithdraw();
    error WithdrawFailed();

    modifier onlySeller() {
        if (msg.sender != seller) revert Unauthorized();
        _;
    }

    modifier onlyAuctioneer() {
        if (msg.sender != auctioneer) revert Unauthorized();
        _;
    }

    constructor(
        address verifier_,
        address seller_,
        address auctioneer_,
        uint64 commitDurationSeconds_,
        uint256 minDeposit_
    ) {
        if (verifier_ == address(0) || seller_ == address(0) || auctioneer_ == address(0)) {
            revert ZeroAddress();
        }
        if (commitDurationSeconds_ == 0) revert InvalidDuration();

        verifier = IHonkVerifier(verifier_);
        seller = seller_;
        auctioneer = auctioneer_;
        commitDeadline = uint64(block.timestamp) + commitDurationSeconds_;
        minDeposit = minDeposit_;
        _phase = Phase.Open;

        for (uint256 i = 0; i < NUM_SLOTS; i++) {
            _commitments[i] = ZERO_BID_COMMITMENT;
        }

        emit AuctionCreated(seller_, auctioneer_, verifier_, commitDeadline, minDeposit_);
    }

    function phase() public view returns (Phase) {
        if (_phase == Phase.Open && block.timestamp >= commitDeadline) {
            return Phase.Closed;
        }
        return _phase;
    }

    function submitBid(
        uint256 slot,
        bytes32 commitment,
        bytes calldata ephemeralPubkey,
        bytes calldata nonce,
        bytes calldata ciphertext
    ) external payable {
        if (_phase != Phase.Open) revert InvalidPhase();
        if (block.timestamp >= commitDeadline) revert CommitPhaseEnded();
        if (slot >= NUM_SLOTS) revert InvalidSlot();
        if (slotFilled[slot]) revert SlotAlreadyFilled();
        if (msg.value < minDeposit) revert DepositTooSmall();
        if (ephemeralPubkey.length == 0 || nonce.length == 0 || ciphertext.length == 0) {
            revert EmptyEncryptedBid();
        }

        bidders[slot] = msg.sender;
        deposits[slot] = msg.value;
        slotFilled[slot] = true;
        _commitments[slot] = commitment;
        _encryptedBids[slot] = EncryptedBid({
            ephemeralPubkey: ephemeralPubkey,
            nonce: nonce,
            ciphertext: ciphertext
        });
        totalBids++;

        emit BidCommitted(slot, msg.sender, commitment, ephemeralPubkey, nonce, ciphertext, msg.value);
    }

    function closeCommitPhase() external {
        if (_phase != Phase.Open) revert InvalidPhase();
        if (block.timestamp < commitDeadline) revert CommitPhaseStillOpen();
        _phase = Phase.Closed;
        emit AuctionClosed();
    }

    function finalize(uint256 winnerIndex_, uint256 secondPrice_, bytes calldata proof) external onlyAuctioneer {
        Phase currentPhase = phase();
        if (currentPhase != Phase.Closed) revert InvalidPhase();
        if (totalBids == 0) revert NoBids();
        if (winnerIndex_ >= NUM_SLOTS || !slotFilled[winnerIndex_]) revert InvalidWinner();
        if (secondPrice_ > MAX_U64 || secondPrice_ > deposits[winnerIndex_]) revert InvalidSecondPrice();

        bytes32[] memory publicInputs = _publicInputs(winnerIndex_, secondPrice_);
        if (!verifier.verify(proof, publicInputs)) revert InvalidProof();

        _phase = Phase.Finalized;
        winnerIndex = winnerIndex_;
        secondPrice = secondPrice_;

        pendingWithdrawals[seller] += secondPrice_;
        for (uint256 i = 0; i < NUM_SLOTS; i++) {
            if (!slotFilled[i]) continue;
            if (i == winnerIndex_) {
                pendingWithdrawals[bidders[i]] += deposits[i] - secondPrice_;
            } else {
                pendingWithdrawals[bidders[i]] += deposits[i];
            }
        }

        emit AuctionFinalized(winnerIndex_, bidders[winnerIndex_], secondPrice_);
    }

    function cancel() external onlySeller {
        Phase currentPhase = phase();
        if (currentPhase == Phase.Finalized || currentPhase == Phase.Cancelled) revert InvalidPhase();

        _phase = Phase.Cancelled;
        for (uint256 i = 0; i < NUM_SLOTS; i++) {
            if (slotFilled[i]) {
                pendingWithdrawals[bidders[i]] += deposits[i];
            }
        }

        emit AuctionCancelled();
    }

    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert WithdrawFailed();

        emit Withdrawal(msg.sender, amount);
    }

    function getCommitment(uint256 slot) external view returns (bytes32) {
        if (slot >= NUM_SLOTS) revert InvalidSlot();
        return _commitments[slot];
    }

    function getCommitments() external view returns (bytes32[] memory out) {
        out = new bytes32[](NUM_SLOTS);
        for (uint256 i = 0; i < NUM_SLOTS; i++) {
            out[i] = _commitments[i];
        }
    }

    function getEncryptedBid(uint256 slot) external view returns (EncryptedBid memory) {
        if (slot >= NUM_SLOTS) revert InvalidSlot();
        return _encryptedBids[slot];
    }

    function previewPublicInputs(
        uint256 winnerIndex_,
        uint256 secondPrice_
    ) external view returns (bytes32[] memory) {
        if (winnerIndex_ >= NUM_SLOTS) revert InvalidSlot();
        return _publicInputs(winnerIndex_, secondPrice_);
    }

    function _publicInputs(
        uint256 winnerIndex_,
        uint256 secondPrice_
    ) internal view returns (bytes32[] memory publicInputs) {
        publicInputs = new bytes32[](PUBLIC_INPUT_COUNT);
        for (uint256 i = 0; i < NUM_SLOTS; i++) {
            publicInputs[i] = _commitments[i];
        }
        publicInputs[5] = bytes32(winnerIndex_);
        publicInputs[6] = bytes32(secondPrice_);
    }
}
