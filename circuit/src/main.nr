// ZKBid circuit: proves a Vickrey auction result is correct without revealing bids.
//
// Private inputs:
//   bids[5]   - decrypted bid amounts (must fit in 64 bits each)
//   salts[5]  - random nonces used to form commitments
//
// Public inputs:
//   commitments[5] - Poseidon2(bids[i], salts[i]) for each bidder slot
//   winner_index   - declared winner index (0-indexed, u32)
//   second_price   - declared settlement price (second-highest bid)
//
// Proves three things:
//   1. Commitment integrity: hash(bids[i], salts[i]) == commitments[i] for all i
//   2. Winner correctness (lowest-index tiebreak):
//        bids[winner_index] > bids[i]  for all i < winner_index (strict)
//        bids[winner_index] >= bids[i] for all i > winner_index
//   3. Second-price correctness:
//        second_price >= bids[i] for all i != winner_index
//        second_price == bids[j] for at least one j != winner_index
//        (when single real bidder, all other bids are 0, so second_price == 0)
//
// Public signal ordering for Person 1 (verifyProof):
//   [commitments[0], commitments[1], commitments[2], commitments[3], commitments[4],
//    winner_index, second_price]

// Poseidon2 fixed-length hash of exactly 2 field elements.
// Implements the sponge from noir_stdlib/src/hash/poseidon2.nr using the
// public poseidon2_permutation primitive (Poseidon2 struct is pub(crate)).
//   State size = 4 (BN254 Barretenberg config)
//   IV = message_size * 2^64 = 2 * 18446744073709551616
//   Absorb a, b into positions 0 and 1 of the initial state
//   Apply permutation; return state[0]
fn poseidon2_hash_2(a: Field, b: Field) -> Field {
    let iv: Field = 2 * 18446744073709551616;
    let state = std::hash::poseidon2_permutation([a, b, 0, iv]);
    state[0]
}

fn main(
    bids: [Field; 5],
    salts: [Field; 5],
    commitments: pub [Field; 5],
    winner_index: pub u32,
    second_price: pub Field,
) {
    // -----------------------------------------------------------------------
    // Bounds check: winner_index must be a valid bidder slot
    // -----------------------------------------------------------------------
    assert(winner_index < 5);

    // -----------------------------------------------------------------------
    // 1. 64-bit range checks on all bids and second_price
    //    Cast Field -> u64 then verify no truncation occurred.
    //    Prevents field wrap-around attacks where a bid overflows to
    //    appear smaller than its true value.
    // -----------------------------------------------------------------------
    let mut bids_u64: [u64; 5] = [0; 5];
    for i in 0..5 {
        let b = bids[i] as u64;
        assert(b as Field == bids[i]);
        bids_u64[i] = b;
    }
    let sp_u64 = second_price as u64;
    assert(sp_u64 as Field == second_price);

    // -----------------------------------------------------------------------
    // 2. Commitment integrity
    //    Poseidon2(bids[i], salts[i]) must equal the on-chain commitment.
    // -----------------------------------------------------------------------
    for i in 0..5 {
        let computed = poseidon2_hash_2(bids[i], salts[i]);
        assert(computed == commitments[i]);
    }

    // -----------------------------------------------------------------------
    // 3. Winner correctness with lowest-index tiebreak
    //    For indices below winner: strict inequality (tied lower index invalid)
    //    For indices above winner: non-strict inequality (tied higher index OK)
    // -----------------------------------------------------------------------
    let winner_bid = bids_u64[winner_index];

    for i in 0..5 {
        let i_u32 = i as u32;
        if i_u32 < winner_index {
            assert(winner_bid > bids_u64[i]);
        }
        if i_u32 > winner_index {
            assert(winner_bid >= bids_u64[i]);
        }
    }

    // -----------------------------------------------------------------------
    // 4. Second-price correctness
    //    second_price must equal max(bids[i] for i != winner_index).
    //    Proof:
    //      (a) second_price >= every non-winner bid (upper bound)
    //      (b) some non-winner bid equals second_price (tightness)
    //    Single-bidder edge case: all non-winner bids are 0 and
    //    second_price = 0, so (b) is satisfied by the zero-padded slots.
    // -----------------------------------------------------------------------
    let mut found_second: bool = false;
    for i in 0..5 {
        let i_u32 = i as u32;
        if i_u32 != winner_index {
            assert(sp_u64 >= bids_u64[i]);
            if bids_u64[i] == sp_u64 {
                found_second = true;
            }
        }
    }
    assert(found_second);
}

// ---------------------------------------------------------------------------
// Unit tests -- run with: nargo test --show-output
// ---------------------------------------------------------------------------

// Prints hash values for use in test Prover.toml files.
// Format strings can't contain function calls -- pre-compute into variables.
#[test]
fn test_print_hash_values() {
    let h00   = poseidon2_hash_2(0, 0);
    let h1001 = poseidon2_hash_2(100, 1);
    let h2002 = poseidon2_hash_2(200, 2);
    let h3003 = poseidon2_hash_2(300, 3);
    let h4004 = poseidon2_hash_2(400, 4);
    let h5005 = poseidon2_hash_2(500, 5);
    let h30099 = poseidon2_hash_2(300, 99);
    let h2507  = poseidon2_hash_2(250, 7);
    let h2508  = poseidon2_hash_2(250, 8);
    let h2509  = poseidon2_hash_2(250, 9);
    let h25010 = poseidon2_hash_2(250, 10);
    let h25011 = poseidon2_hash_2(250, 11);
    let h50010 = poseidon2_hash_2(500, 10);
    let h50020 = poseidon2_hash_2(500, 20);
    let h30030 = poseidon2_hash_2(300, 30);
    let h20040 = poseidon2_hash_2(200, 40);
    let h10050 = poseidon2_hash_2(100, 50);
    std::println(f"Poseidon2(0,0)    = {h00}");
    std::println(f"Poseidon2(100,1)  = {h1001}");
    std::println(f"Poseidon2(200,2)  = {h2002}");
    std::println(f"Poseidon2(300,3)  = {h3003}");
    std::println(f"Poseidon2(400,4)  = {h4004}");
    std::println(f"Poseidon2(500,5)  = {h5005}");
    std::println(f"Poseidon2(300,99) = {h30099}");
    std::println(f"Poseidon2(250,7)  = {h2507}");
    std::println(f"Poseidon2(250,8)  = {h2508}");
    std::println(f"Poseidon2(250,9)  = {h2509}");
    std::println(f"Poseidon2(250,10) = {h25010}");
    std::println(f"Poseidon2(250,11) = {h25011}");
    std::println(f"Poseidon2(500,10) = {h50010}");
    std::println(f"Poseidon2(500,20) = {h50020}");
    std::println(f"Poseidon2(300,30) = {h30030}");
    std::println(f"Poseidon2(200,40) = {h20040}");
    std::println(f"Poseidon2(100,50) = {h10050}");
}

// 5 bidders, distinct bids: [100, 200, 300, 400, 500]
// Winner = index 4 (bid 500), second_price = 400
#[test]
fn test_basic_distinct_bids() {
    let bids: [Field; 5] = [100, 200, 300, 400, 500];
    let salts: [Field; 5] = [1, 2, 3, 4, 5];
    let mut commitments: [Field; 5] = [0; 5];
    for i in 0..5 {
        commitments[i] = poseidon2_hash_2(bids[i], salts[i]);
    }
    main(bids, salts, commitments, 4, 400);
}

// Two bidders tie for highest: [500, 500, 300, 200, 100]
// Winner = index 0 (lowest index wins tie), second_price = 500
#[test]
fn test_tied_highest() {
    let bids: [Field; 5] = [500, 500, 300, 200, 100];
    let salts: [Field; 5] = [10, 20, 30, 40, 50];
    let mut commitments: [Field; 5] = [0; 5];
    for i in 0..5 {
        commitments[i] = poseidon2_hash_2(bids[i], salts[i]);
    }
    main(bids, salts, commitments, 0, 500);
}

// Single real bidder: [300, 0, 0, 0, 0]
// Winner = index 0, second_price = 0
#[test]
fn test_single_bidder() {
    let bids: [Field; 5] = [300, 0, 0, 0, 0];
    let salts: [Field; 5] = [99, 0, 0, 0, 0];
    let mut commitments: [Field; 5] = [0; 5];
    for i in 0..5 {
        commitments[i] = poseidon2_hash_2(bids[i], salts[i]);
    }
    main(bids, salts, commitments, 0, 0);
}

// All equal bids: winner must be index 0 (lowest index tiebreak)
// second_price = 250 (one of the other equal bids)
#[test]
fn test_all_equal() {
    let bids: [Field; 5] = [250, 250, 250, 250, 250];
    let salts: [Field; 5] = [7, 8, 9, 10, 11];
    let mut commitments: [Field; 5] = [0; 5];
    for i in 0..5 {
        commitments[i] = poseidon2_hash_2(bids[i], salts[i]);
    }
    main(bids, salts, commitments, 0, 250);
}

// Tampered winner: winner_index=3 but bids[4]=500 > bids[3]=400 -- should FAIL
#[test(should_fail)]
fn test_tampered_winner_should_fail() {
    let bids: [Field; 5] = [100, 200, 300, 400, 500];
    let salts: [Field; 5] = [1, 2, 3, 4, 5];
    let mut commitments: [Field; 5] = [0; 5];
    for i in 0..5 {
        commitments[i] = poseidon2_hash_2(bids[i], salts[i]);
    }
    // Wrong winner: index 3 (bid=400) instead of index 4 (bid=500)
    main(bids, salts, commitments, 3, 500);
}

// Tampered price: correct winner but wrong second_price -- should FAIL
#[test(should_fail)]
fn test_tampered_price_should_fail() {
    let bids: [Field; 5] = [100, 200, 300, 400, 500];
    let salts: [Field; 5] = [1, 2, 3, 4, 5];
    let mut commitments: [Field; 5] = [0; 5];
    for i in 0..5 {
        commitments[i] = poseidon2_hash_2(bids[i], salts[i]);
    }
    // Correct winner (index 4, bid=500) but wrong second_price (300 instead of 400)
    main(bids, salts, commitments, 4, 300);
}

// Tampered commitment: bids don't match commitments -- should FAIL
#[test(should_fail)]
fn test_tampered_commitment_should_fail() {
    let real_bids: [Field; 5] = [100, 200, 300, 400, 500];
    let salts: [Field; 5] = [1, 2, 3, 4, 5];
    // Commitments computed from real bids but prover tries to use different bids
    let mut commitments: [Field; 5] = [0; 5];
    for i in 0..5 {
        commitments[i] = poseidon2_hash_2(real_bids[i], salts[i]);
    }
    // Lie: claim bids are all 999 while commitments are for 100,200,...
    let fake_bids: [Field; 5] = [999, 999, 999, 999, 999];
    main(fake_bids, salts, commitments, 4, 999);
}

// Tiebreak violation: wrong winner when tied -- should FAIL
// bids=[500,500,...], winner claimed to be index 1 (not the lowest tied index)
#[test(should_fail)]
fn test_tiebreak_violation_should_fail() {
    let bids: [Field; 5] = [500, 500, 300, 200, 100];
    let salts: [Field; 5] = [10, 20, 30, 40, 50];
    let mut commitments: [Field; 5] = [0; 5];
    for i in 0..5 {
        commitments[i] = poseidon2_hash_2(bids[i], salts[i]);
    }
    // Wrong: index 1 claimed as winner, but index 0 also bid 500 (lower index should win)
    main(bids, salts, commitments, 1, 500);
}
