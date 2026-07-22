const CONFLUX_ESPACE_NETWORKS = new Set(["conflux", "confluxTestnet"]);

export const selectedHardhatNetwork = (argv = process.argv) => {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--network") return argv[index + 1] || "";
    if (value.startsWith("--network=")) return value.slice("--network=".length);
  }
  return "";
};

export const isConfluxESpaceNetwork = (networkName) => CONFLUX_ESPACE_NETWORKS.has(networkName);

// ConfluxScan accepts a non-empty placeholder. Ethereum's Etherscan does not: leaving the value
// empty there makes verification fail until the operator explicitly supplies a real API key.
export const explorerApiKeyForNetwork = (networkName, configuredApiKey = "") => {
  const configured = String(configuredApiKey).trim();
  if (configured !== "") {
    // Prevent the documented Conflux-only placeholder from being accidentally sent to Etherscan.
    if (!isConfluxESpaceNetwork(networkName) && configured.toLowerCase() === "espace") return "";
    return configured;
  }
  return isConfluxESpaceNetwork(networkName) ? "espace" : "";
};

export const connectionNetworkName = (connection) => {
  const networkName =
    connection?.networkName || connection?.network?.name || connection?.network?.networkName;
  if (!networkName || networkName === "unknown") {
    throw new Error("Cannot print a verification command without the current Hardhat network name");
  }
  return networkName;
};

const assertSafeCommandValue = (label, value, pattern) => {
  if (!pattern.test(String(value))) {
    throw new Error(`Cannot build verification command: invalid ${label} "${value}"`);
  }
};

export const buildImplementationVerificationCommand = ({
  networkName,
  sourceName,
  contractName,
  implementation,
}) => {
  assertSafeCommandValue("network name", networkName, /^[A-Za-z0-9_-]+$/);
  assertSafeCommandValue("source name", sourceName, /^[A-Za-z0-9_@./-]+$/);
  assertSafeCommandValue("contract name", contractName, /^[A-Za-z_][A-Za-z0-9_]*$/);
  assertSafeCommandValue("implementation address", implementation, /^0x[0-9a-fA-F]{40}$/);

  return (
    "npx hardhat --config hardhat.config.mjs --build-profile production verify " +
    `--network ${networkName} --contract ${sourceName}:${contractName} ${implementation}`
  );
};

export const candidateVerificationGuidance = ({
  networkName,
  sourceName,
  contractName,
  implementation,
  freshlyDeployed,
}) => {
  const command = buildImplementationVerificationCommand({
    networkName,
    sourceName,
    contractName,
    implementation,
  });
  const lines = [
    "candidate implementation source-verification prerequisite:",
    `  network:      ${networkName}`,
    `  artifact:     ${sourceName}:${contractName}`,
    `  implementation: ${implementation}`,
  ];

  if (isConfluxESpaceNetwork(networkName)) {
    lines.push(
      '  API key: ConfluxScan uses the non-secret fallback "espace" when EXPLORER_API_KEY is unset.',
    );
  } else {
    lines.push(
      "  API key: set EXPLORER_API_KEY to a real Etherscan API key; the Conflux placeholder is not valid here.",
    );
  }

  lines.push(`  command: ${command}`);
  lines.push("  This task does not contact the explorer or claim that verification succeeded.");

  if (freshlyDeployed) {
    lines.push(
      "  STOP: no Timelock operation was scheduled. Run the command above, confirm explorer " +
        "verification succeeded, then rerun upgrade-schedule with this address in --implementation.",
    );
  } else {
    lines.push(
      "  Confirm this exact address/artifact is verified before submitting any printed schedule " +
        "to/value/data transaction to the governance multisig.",
    );
  }

  return { command, lines, stopBeforeScheduling: freshlyDeployed };
};

export const printCandidateVerificationGuidance = (options, log = console.log) => {
  const guidance = candidateVerificationGuidance(options);
  for (const line of guidance.lines) log(line);
  return guidance;
};
