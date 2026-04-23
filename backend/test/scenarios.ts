// Canonical test scenarios copied from circuit/test-inputs/*/Prover.toml.
// Commitments are the real Poseidon2 hashes; the circuit will validate them.

export interface Scenario {
  name: string;
  bids: string[]; // length 5, decimal strings
  salts: string[]; // length 5, decimal strings
  commitments: string[]; // length 5, 0x-hex
  winnerIndex: number;
  secondPrice: string; // decimal string
  // slots array sent to the backend; every other slot is treated as empty
  // (the empty slots still need to be present in commitments, using the
  // Poseidon2(0,0) sentinel -- handled by the backend's zero-pad logic).
  submittedSlots?: number[];
}

const BASIC: Scenario = {
  name: "basic",
  bids: ["100", "200", "300", "400", "500"],
  salts: ["1", "2", "3", "4", "5"],
  commitments: [
    "0x0b9ad17d3d4fb2312e03a54420f18a745b0fac191ba33336e12dd566ec5a0756",
    "0x27f17d88420e8006ecaba663ebc0bbaccd7aaa60e22f6a6f97a05270124a1f46",
    "0x1c6fbea11355a1cb48a260349444417ce4db7c7cd34ab7f0025fbba605ccb12c",
    "0x1a6b7105ff9260f558b7d32dd3350dbda162bf75aa8075ab3700339206b9c669",
    "0x09cbc236f417b4e7b85d6b7d4668c7ddd710f39a519df883b0f322d1d3facb1d",
  ],
  winnerIndex: 4,
  secondPrice: "400",
};

const TIED: Scenario = {
  name: "tied",
  bids: ["500", "500", "300", "200", "100"],
  salts: ["10", "20", "30", "40", "50"],
  commitments: [
    "0x285fdea7a74a4fe67ae4da620fd725d41d46f3dd8373a224c7155a220e9534ad",
    "0x15cbad64c816989ad949c4fe6aba18237ec9cf55d04dc8d86a58e5fb6f3a7d19",
    "0x1b42273fc7c715623ff7ae7c88006a5bbb9828f98e8663d957fa0b4ef5786524",
    "0x22564e218060801a87a84f6ab07200517ef52e8006027634778f02ced077f887",
    "0x1edce2a06f73a14a2d324aebc1de65cb37f4f8c85bd7033278f6fabad17c15e3",
  ],
  winnerIndex: 0,
  secondPrice: "500",
};

// Single real bidder in slot 0; remaining slots are empty (Poseidon2(0,0)).
// The backend must zero-pad slots 1-4 itself; we only submit slot 0.
const SINGLE: Scenario = {
  name: "single",
  bids: ["300", "0", "0", "0", "0"],
  salts: ["99", "0", "0", "0", "0"],
  commitments: [
    "0x22d7f4aedbc4b2c9d3a651da768654ba52dd3df198039828605232953e164656",
    "0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1",
    "0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1",
    "0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1",
    "0x0b63a53787021a4a962a452c2921b3663aff1ffd8d5510540f8e659e782956f1",
  ],
  winnerIndex: 0,
  secondPrice: "0",
  submittedSlots: [0],
};

const ALL_EQUAL: Scenario = {
  name: "all-equal",
  bids: ["250", "250", "250", "250", "250"],
  salts: ["7", "8", "9", "10", "11"],
  commitments: [
    "0x16f56523bcbca16386c0ec5e6fd38991129b6fc6b9edd44c98f20bc84e325582",
    "0x0706f24642388c9e3517b6676d4093fb9629eb093109ba54f394f6e6e317fb34",
    "0x0406d1c5d2056661ec2c9bbf0f3c19f7ee30920459c581394e0706ec78302282",
    "0x2c631f2dace8d87bf39e3b88a262e35b1cb97f1201ec4c46f8ee7a428ddb5c3e",
    "0x26f97dacdaa05bcc3953a5d2131c4de41c865bf5024fbd132837c362fa535917",
  ],
  winnerIndex: 0,
  secondPrice: "250",
};

export const SCENARIOS: Scenario[] = [BASIC, TIED, SINGLE, ALL_EQUAL];
