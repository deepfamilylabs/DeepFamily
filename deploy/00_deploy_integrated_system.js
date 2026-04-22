// SPDX-License-Identifier: MIT
// Deploy the integrated DeepFamily system (DeepFamilyToken + DeepFamily) with hardhat-deploy

const func = async ({ getNamedAccounts, deployments, ethers, network }) => {
  const { deploy, log, save } = deployments;
  const { deployer } = await getNamedAccounts();

  log(`Deployment account: ${deployer}`);
  log(`Current network: ${network.name}`);

  // 1) Deploy DeepFamilyToken
  const tokenDeployment = await deploy("DeepFamilyToken", {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: network.live ? 2 : 1,
    redeployIfChanged: true,
  });

  // 2) Deploy Poseidon library (T5 for 4-input Poseidon used in disclosure binding)
  const poseidonT5Deployment = await deploy("PoseidonT5", {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: network.live ? 2 : 1,
    redeployIfChanged: true,
  });

  log(`PoseidonT5 library deployed at: ${poseidonT5Deployment.address}`);

  // 3) Deploy PersonCommitmentVerifier (ZK proof verifier for addPersonVersion)
  const personVerifierDeployment = await deploy("PersonCommitmentVerifier", {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: network.live ? 2 : 1,
    redeployIfChanged: true,
  });

  log(`PersonCommitmentVerifier deployed at: ${personVerifierDeployment.address}`);

  // 4) Deploy DisclosureBindingVerifier (ZK proof verifier for mintPersonVersionNFT)
  const nameVerifierDeployment = await deploy("DisclosureBindingVerifier", {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: network.live ? 2 : 1,
    redeployIfChanged: true,
  });

  log(`DisclosureBindingVerifier deployed at: ${nameVerifierDeployment.address}`);

  // 4b) Deploy Groth16VerifierAdapter (Phase 2 transport-layer adapter)
  const groth16AdapterDeployment = await deploy("Groth16VerifierAdapter", {
    from: deployer,
    args: [personVerifierDeployment.address, nameVerifierDeployment.address],
    log: true,
    waitConfirmations: network.live ? 2 : 1,
    redeployIfChanged: true,
  });

  log(`Groth16VerifierAdapter deployed at: ${groth16AdapterDeployment.address}`);

  // 5) Deploy DeepFamily with PoseidonT5 linked
  const deepFamilyDeployment = await deploy("DeepFamily", {
    from: deployer,
    args: [tokenDeployment.address],
    libraries: {
      PoseidonT5: poseidonT5Deployment.address,
    },
    log: true,
    waitConfirmations: network.live ? 2 : 1,
    redeployIfChanged: true,
  });

  // 6) Initialize the DeepFamilyToken contract (set DeepFamily address)
  const deepFamilyToken = await ethers.getContractAt("DeepFamilyToken", tokenDeployment.address);
  let needInit = true;
  try {
    const bound = await deepFamilyToken.deepFamilyContract();
    needInit = bound === ethers.ZeroAddress;
  } catch (_) {
    needInit = true;
  }
  if (needInit) {
    const tx = await deepFamilyToken.initialize(deepFamilyDeployment.address);
    await tx.wait();
    log("DeepFamilyToken initialized");
  }

  // 7) Register the Groth16 adapter under PROOF_SYSTEM_ID_GROTH16_BN254_V1 = 1
  //    for both purposes (PersonCommitment = 0, DisclosureBinding = 1). Phase 2 routes business
  //    entrypoints to the adapter, which internally dispatches to the backend verifiers.
  const deepFamily = await ethers.getContractAt("DeepFamily", deepFamilyDeployment.address);
  const tx1 = await deepFamily.setVerifier(1, 0, groth16AdapterDeployment.address);
  await tx1.wait();
  log(`Groth16VerifierAdapter registered for (proofSystemId=1, purpose=PersonCommitment)`);

  const tx2 = await deepFamily.setVerifier(1, 1, groth16AdapterDeployment.address);
  await tx2.wait();
  log(`Groth16VerifierAdapter registered for (proofSystemId=1, purpose=DisclosureBinding)`);

  log("Deployment finished");
};

module.exports = func;
module.exports.tags = [
  "DeepFamily",
  "DeepFamilyToken",
  "PersonCommitmentVerifier",
  "DisclosureBindingVerifier",
  "Groth16VerifierAdapter",
  "PoseidonT5",
  "Integrated",
];
