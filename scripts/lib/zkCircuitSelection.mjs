const CIRCUIT_CHOICES = Object.freeze(["all", "person", "disclosure"]);

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
      "Usage: --circuit <all|person|disclosure> (the option may be omitted to select all)",
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
  return circuit === "all" ? Object.freeze(["person", "disclosure"]) : Object.freeze([circuit]);
};
