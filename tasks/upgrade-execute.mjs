import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import {
  resolveTarget,
  encodeUpgradeCall,
  deriveSalt,
  sendOrPrint,
  updateDeploymentImplementation,
} from "./lib/timelockUpgrade.mjs";

const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const confirmUpgrade = async (connection, ethers, spec, proxyAddress, implementation) => {
  const raw = await ethers.provider.getStorage(proxyAddress, ERC1967_IMPLEMENTATION_SLOT);
  const liveImpl = ethers.getAddress(ethers.dataSlice(raw, 12));
  console.log(`  proxy implementation slot now: ${liveImpl}`);
  if (liveImpl.toLowerCase() !== implementation.toLowerCase()) {
    throw new Error(
      `proxy implementation slot ${liveImpl} does not match requested implementation ${implementation}`,
    );
  }

  console.log("  upgrade confirmed on-chain.");
  const result = await updateDeploymentImplementation(connection, spec.contract, liveImpl);
  if (result.updated) {
    console.log(`  updated implementationAddress in ${result.filePath}`);
  } else if (result.error) {
    console.log(`  note: could not refresh ${result.filePath}: ${result.error.message}`);
  }
  return liveImpl;
};

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const [signer] = await ethers.getSigners();

  if (!args.implementation || args.implementation === "") {
    throw new Error("--implementation <addr> is required and must match the scheduled upgrade");
  }

  const { spec, proxy, proxyAddress, timelock, timelockAddress } = await resolveTarget(
    connection,
    ethers,
    args.target,
  );

  const implementation = args.implementation;
  const initData = args.initData && args.initData !== "" ? args.initData : "0x";
  const predecessor = ethers.ZeroHash;
  const salt = deriveSalt(ethers, {
    target: args.target,
    implementation,
    initData,
    override: args.salt,
  });
  const upgradeData = encodeUpgradeCall(proxy, implementation, initData);
  const operationId = await timelock.hashOperation(
    proxyAddress,
    0n,
    upgradeData,
    predecessor,
    salt,
  );

  console.log("upgrade execute plan:");
  console.log(`  target:      ${args.target} (${spec.contract} @ ${proxyAddress})`);
  console.log(`  timelock:    ${timelockAddress}`);
  console.log(`  newImpl:     ${implementation}`);
  console.log(`  operationId: ${operationId}`);

  if (await timelock.isOperationDone(operationId)) {
    console.log("  operation already executed; confirming proxy state");
    const liveImpl = await confirmUpgrade(connection, ethers, spec, proxyAddress, implementation);
    return { operationId, executed: true, alreadyDone: true, liveImpl };
  }
  if (!(await timelock.isOperationReady(operationId))) {
    const readyAt = await timelock.getTimestamp(operationId);
    if (readyAt === 0n) {
      throw new Error(
        "operation is not scheduled; run upgrade-schedule first (and check the args match)",
      );
    }
    throw new Error(`operation not ready yet; the timelock delay elapses at unix ${readyAt}`);
  }

  const executorRole = await timelock.EXECUTOR_ROLE();
  // EXECUTOR_ROLE granted to address(0) means execution is open to anyone after the delay.
  const openExecutor = await timelock.hasRole(executorRole, ethers.ZeroAddress);
  let executed = false;
  if (openExecutor) {
    console.log("  executor role is open (address(0)); executing directly");
    const tx = await timelock
      .connect(signer)
      .execute(proxyAddress, 0n, upgradeData, predecessor, salt);
    await tx.wait();
    console.log(`  executed: tx ${tx.hash}`);
    executed = true;
  } else {
    const result = await sendOrPrint({
      timelock,
      timelockAddress,
      signer,
      role: executorRole,
      method: "execute",
      callArgs: [proxyAddress, 0n, upgradeData, predecessor, salt],
    });
    executed = result.sent === true;
  }

  // If the signer could not execute (multisig path), the upgrade has not happened yet.
  // Skip the proxy slot check — it would just show the old implementation and confuse callers.
  if (!executed) {
    console.log(
      "  upgrade NOT executed: calldata above must be submitted by an EXECUTOR_ROLE holder " +
        "(typically the multisig). Re-run this task after submission to confirm and refresh metadata.",
    );
    return { operationId, executed: false };
  }

  const liveImpl = await confirmUpgrade(connection, ethers, spec, proxyAddress, implementation);
  return { operationId, executed: true, liveImpl };
};

export default task("upgrade-execute", "Execute a previously scheduled timelock UUPS upgrade")
  .addOption({
    name: "target",
    description: "Proxy to upgrade: main",
    type: ArgumentType.STRING,
    defaultValue: "main",
  })
  .addOption({
    name: "implementation",
    description: "New implementation address (must match the scheduled upgrade)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "initData",
    description: "Calldata passed to upgradeToAndCall (must match the scheduled upgrade)",
    type: ArgumentType.STRING,
    defaultValue: "0x",
  })
  .addOption({
    name: "salt",
    description: "Override salt (must match the value used at schedule time)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
