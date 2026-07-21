/**
 * Usage with an already deployed, verified candidate implementation:
 *   npx hardhat --config hardhat.config.mjs upgrade-schedule --network confluxTestnet \
 *     --target main --contract-name DeepFamilyV2 --implementation 0xNewImplementation
 *
 * Required: --contract-name. Omit --implementation to deploy the candidate only: the task prints
 * its exact explorer verification command and deliberately stops without scheduling. After source
 * verification succeeds, rerun with that address in --implementation. Keep --target,
 * --implementation, --init-data, and optional --salt identical for execution. If the signer is not
 * the proposer, submit the printed to/value/data through the governance multisig only after
 * verification; the delay starts when that schedule transaction is mined. A supplied
 * implementation must match the selected artifact's deployed runtime.
 * --skip-storage-check skips only the baseline preflight; candidate layout validation still runs.
 * List every option with:
 *   npx hardhat --config hardhat.config.mjs upgrade-schedule --help
 */
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
import {
  connectionNetworkName,
  printCandidateVerificationGuidance,
} from "./lib/explorerVerification.mjs";

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const [signer] = await ethers.getSigners();

  const haveContractName = Boolean(args.contractName) && args.contractName !== "";
  const havePreDeployed = Boolean(args.implementation) && args.implementation !== "";
  if (!haveContractName) {
    throw new Error(
      "--contract-name <artifact> is mandatory: the upgrade task will not schedule an " +
        "implementation whose storage layout and runtime bytecode cannot be validated",
    );
  }

  if (!args.skipStorageCheck) {
    console.log("storage-layout baseline check (pre-flight):");
    runStorageCheck();
  }

  const { spec, proxy, proxyAddress, timelock, timelockAddress } = await resolveTarget(
    connection,
    ethers,
    args.target,
  );

  // Candidate storage-layout check is mandatory whenever an artifact name is provided, regardless
  // of --skipStorageCheck (which only skips the baseline preflight at the top of this task). The
  // candidate check is the actual upgrade-safety gate; gating it on the same flag as the preflight
  // would let an operator accidentally disable both with one switch.
  await assertImplementationStorageSafe(hre, spec.contract, args.contractName);

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
    if (!signer) {
      throw new Error(
        "No signer is configured to deploy the new implementation. Pre-deploy it with a reviewed " +
          "account, then pass both --implementation and --contract-name.",
      );
    }
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

  const candidateArtifact = await hre.artifacts.readArtifact(args.contractName);
  const verification = printCandidateVerificationGuidance({
    networkName: connectionNetworkName(connection),
    sourceName: candidateArtifact.sourceName,
    contractName: candidateArtifact.contractName,
    implementation,
    freshlyDeployed: !havePreDeployed,
  });

  // Explorer verification is intentionally manual: an automatic deployment cannot be both newly
  // mined and already verified. Stop here so no schedule calldata exists before the operator has
  // verified the exact candidate, then require the pre-deployed path on the second invocation.
  if (verification.stopBeforeScheduling) {
    return {
      implementation,
      verificationCommand: verification.command,
      scheduled: false,
      requiresVerification: true,
    };
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
  return {
    implementation,
    operationId,
    salt,
    scheduled: result.sent,
    verificationCommand: verification.command,
  };
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
    description:
      "Address of an already-deployed and source-verified implementation (skips deployment)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "contractName",
    description: "Implementation artifact used for mandatory storage and bytecode validation",
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
  .setAction(() => Promise.resolve({ default: action }))
  .build();
