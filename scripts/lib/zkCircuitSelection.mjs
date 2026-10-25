import { PROTOCOL_CIRCUITS } from "./protocolCircuitCatalog.mjs";
export { PROTOCOL_CIRCUITS };

export const SHIELDED_CIRCUITS = Object.freeze({
  shield: "shielded_shield",
  unshield: "shielded_unshield",
  unshield4: "shielded_unshield_4",
});
export const hasShieldedSolidityVerifier = (action) => Object.hasOwn(SHIELDED_CIRCUITS, action);

export const CORE_CIRCUITS = Object.freeze(["person", "disclosure"]);
export const SHIELDED_CIRCUIT_NAMES = Object.freeze(
  Object.keys(SHIELDED_CIRCUITS).map((action) => `shielded:${action}`),
);
export const BOUNDARY_CIRCUIT_NAMES = Object.freeze([
  "shielded:shield",
  "shielded:unshield",
  "shielded:unshield4",
]);
export const PROTOCOL_CIRCUIT_NAMES = Object.freeze(
  Object.keys(PROTOCOL_CIRCUITS).map((name) => `protocol:${name}`),
);
export const CANONICAL_CIRCUIT_NAMES = Object.freeze([
  ...CORE_CIRCUITS,
  ...BOUNDARY_CIRCUIT_NAMES,
  ...PROTOCOL_CIRCUIT_NAMES,
]);
const CIRCUIT_CHOICES = Object.freeze([
  "all",
  "core",
  ...CORE_CIRCUITS,
  "shielded",
  "protocol",
  ...SHIELDED_CIRCUIT_NAMES,
  ...PROTOCOL_CIRCUIT_NAMES,
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
      "Usage: --circuit <all|core|person|disclosure|shielded|shielded:action|protocol|protocol:action> " +
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
  if (circuit === "all") return CANONICAL_CIRCUIT_NAMES;
  if (circuit === "core") return CORE_CIRCUITS;
  if (circuit === "shielded") return BOUNDARY_CIRCUIT_NAMES;
  if (circuit === "protocol") return PROTOCOL_CIRCUIT_NAMES;
  return Object.freeze([circuit]);
};
