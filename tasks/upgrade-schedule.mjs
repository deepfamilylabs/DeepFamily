import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import {
  resolveTarget,
  deployImplementation,
  encodeUpgradeCall,
  deriveSalt,
  runStorageCheck,
  assertImplementationStorageSafe,
  assertImplementationMatchesArtifact,
  sendOrPrint,
} from "./lib/timelockUpgrade.mjs";

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const [signer] = await ethers.getSigners();

  if (!args.skipStorageCheck) {
    console.log("storage-layout baseline check (pre-flight):");
    runStorageCheck();
  }

  const { spec, proxy, proxyAddress, timelock, timelockAddress } = await resolveTarget(
    connection,
    ethers,
    args.target,
  );

  const haveContractName = Boolean(args.contractName) && args.contractName !== "";
  const havePreDeployed = Boolean(args.implementation) && args.implementation !== "";

  if (!haveContractName && !havePreDeployed) {
    throw new Error(
      "Provide --implementation <addr> or --contract-name <artifact> to deploy a new one",
    );
  }

  // Candidate storage-layout check is mandatory whenever an artifact name is provided, regardless
  // of --skipStorageCheck (which only skips the baseline preflight at the top of this task). The
  // candidate check is the actual upgrade-safety gate; gating it on the same flag as the preflight
  // would let an operator accidentally disable both with one switch.
  if (haveContractName) {
    await assertImplementationStorageSafe(hre, spec.contract, args.contractName);
  } else if (!args.allowUnsafe) {
    throw new Error(
      "--implementation given without --contract-name: cannot validate the implementation's storage " +
        "layout against the proxy baseline. Pass --contract-name <artifact> so the upgrade task can " +
        "diff its layout (and verify the deployed bytecode if --implementation is also given), or " +
        "pass --allow-unsafe to acknowledge that this implementation is opaque to the storage-layout " +
        "checker (NOT recommended for live networks).",
    );
  } else {
    console.warn(
      "WARNING: --allow-unsafe set; the implementation's storage layout is NOT being validated " +
        "against the proxy baseline. Make sure you have verified storage compatibility off-task.",
    );
  }

  let implementation = args.implementation;
  if (havePreDeployed && haveContractName) {
    // Both supplied: operator pre-deployed the implementation but also pointed at the artifact.
    // Verify the on-chain runtime bytecode matches the linked artifact so the layout check above
    // is meaningful for the address being scheduled.
    await assertImplementationMatchesArtifact({
      connection,
      ethers,
      hre,
      contractName: args.contractName,
      implementation,
      spec,
    });
  } else if (!havePreDeployed) {
    console.log(`deploying new implementation from artifact "${args.contractName}"...`);
    implementation = await deployImplementation(
      connection,
      ethers,
      signer,
      spec,
      args.contractName,
    );
    console.log(`  implementation: ${implementation}`);
  }

  const initData = args.initData && args.initData !== "" ? args.initData : "0x";
  const predecessor = ethers.ZeroHash;
  const salt = deriveSalt(ethers, {
    target: args.target,
    implementation,
    initData,
    override: args.salt,
  });
  const upgradeData = encodeUpgradeCall(proxy, implementation, initData);

  const minDelay = await timelock.getMinDelay();
  const delay = args.delay && Number(args.delay) > 0 ? BigInt(args.delay) : minDelay;
  if (delay < minDelay) {
    throw new Error(`--delay ${delay} is below the timelock minDelay ${minDelay}`);
  }

  const operationId = await timelock.hashOperation(
    proxyAddress,
    0n,
    upgradeData,
    predecessor,
    salt,
  );

  console.log("upgrade schedule plan:");
  console.log(`  target:      ${args.target} (${spec.contract} @ ${proxyAddress})`);
  console.log(`  timelock:    ${timelockAddress}`);
  console.log(`  newImpl:     ${implementation}`);
  console.log(`  initData:    ${initData}`);
  console.log(`  salt:        ${salt}`);
  console.log(`  delay:       ${delay} (minDelay ${minDelay})`);
  console.log(`  operationId: ${operationId}`);

  const proposerRole = await timelock.PROPOSER_ROLE();
  const result = await sendOrPrint({
    timelock,
    timelockAddress,
    signer,
    role: proposerRole,
    method: "schedule",
    callArgs: [proxyAddress, 0n, upgradeData, predecessor, salt, delay],
  });

  if (result.sent) {
    console.log(
      `\nNext: after the delay elapses, run upgrade-execute with the same --target/--implementation/--init-data/--salt.`,
    );
  } else {
    console.log(
      "\nNext: submit the calldata above from a proposer/multisig. The timelock delay starts " +
        "only after that schedule transaction is mined; then run upgrade-execute with the same " +
        "--target/--implementation/--init-data/--salt.",
    );
  }
  return { implementation, operationId, salt, scheduled: result.sent };
};

export default task("upgrade-schedule", "Stage a UUPS upgrade through the timelock owner")
  .addOption({
    name: "target",
    description: "Proxy to upgrade: main",
    type: ArgumentType.STRING,
    defaultValue: "main",
  })
  .addOption({
    name: "implementation",
    description: "Address of an already-deployed new implementation (skips deployment)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "contractName",
    description:
      "Artifact name of the new implementation to deploy when --implementation is omitted",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "initData",
    description: "Calldata passed to upgradeToAndCall (default 0x for no reinitializer)",
    type: ArgumentType.STRING,
    defaultValue: "0x",
  })
  .addOption({
    name: "delay",
    description: "Timelock delay in seconds (defaults to the timelock minDelay)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "salt",
    description: "Override the deterministic operation salt (bytes32)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addFlag({
    name: "skipStorageCheck",
    description:
      "Skip the pre-flight baseline storage-layout check only. The candidate-vs-baseline check " +
      "still runs whenever --contract-name is given.",
  })
  .addFlag({
    name: "allowUnsafe",
    description:
      "Allow scheduling --implementation without --contract-name (storage layout cannot be validated)",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
