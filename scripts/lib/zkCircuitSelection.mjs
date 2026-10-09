export const SHIELDED_CIRCUITS = Object.freeze({
  receiveCode: "shielded_receive_code",
  shield: "shielded_shield",
  fund: "shielded_fund",
  claim: "shielded_claim",
  privateTransfer: "shielded_private_transfer",
  unshield: "shielded_unshield",
  privateTransfer8: "shielded_private_transfer_8",
  unshield8: "shielded_unshield_8",
});

/**
 * Receive-code proofs are verified only in the payer's browser. These circuits
 * go through the same build, setup and ceremony, but have no Solidity verifier.
 */
export const SHIELDED_CLIENT_ONLY_CIRCUITS = Object.freeze(["receiveCode"]);
export const hasShieldedSolidityVerifier = (action) =>
  !SHIELDED_CLIENT_ONLY_CIRCUITS.includes(action);

export const CORE_CIRCUITS = Object.freeze(["person", "disclosure"]);
export const SHIELDED_CIRCUIT_NAMES = Object.freeze(
  Object.keys(SHIELDED_CIRCUITS).map((action) => `shielded:${action}`),
);
const CIRCUIT_CHOICES = Object.freeze([
  "all",
  "core",
  ...CORE_CIRCUITS,
  "shielded",
  ...SHIELDED_CIRCUIT_NAMES,
]);

export const parseCircuitArguments = (argv) => {
  if (!Array.isArray(argv)) {
    throw new TypeError("argv must be an array");
  }

  if (argv.length === 0) {
    return Object.freeze({ help: false, circuit: "all" });
  }
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return Object.freeze({ help: true, circuit: "all" });
  }

  let circuit;
  if (argv.length === 2 && argv[0] === "--circuit") {
    circuit = argv[1];
  } else if (argv.length === 1 && typeof argv[0] === "string" && argv[0].startsWith("--circuit=")) {
    circuit = argv[0].slice("--circuit=".length);
  } else {
    throw new Error(
      "Usage: --circuit <all|core|person|disclosure|shielded|shielded:action> " +
        "(the option may be omitted to select all)",
    );
  }

  if (!CIRCUIT_CHOICES.includes(circuit)) {
    throw new Error(
      `Invalid circuit ${JSON.stringify(circuit)}; expected one of: ${CIRCUIT_CHOICES.join(", ")}`,
    );
  }
  return Object.freeze({ help: false, circuit });
};

export const selectCircuitNames = (circuit) => {
  if (!CIRCUIT_CHOICES.includes(circuit)) {
    throw new Error(
      `Invalid circuit ${JSON.stringify(circuit)}; expected one of: ${CIRCUIT_CHOICES.join(", ")}`,
    );
  }
  if (circuit === "all") return Object.freeze([...CORE_CIRCUITS, ...SHIELDED_CIRCUIT_NAMES]);
  if (circuit === "core") return CORE_CIRCUITS;
  if (circuit === "shielded") return SHIELDED_CIRCUIT_NAMES;
  return Object.freeze([circuit]);
};
