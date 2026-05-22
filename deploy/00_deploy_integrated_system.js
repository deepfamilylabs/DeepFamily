// SPDX-License-Identifier: MIT
// Deploy the integrated DeepFamily system (DeepFamilyToken + DeepFamily) with hardhat-deploy

const func = async ({ getNamedAccounts, deployments, ethers, network }) => {
  const { deploy, log, save } = deployments;
  const { deployer } = await getNamedAccounts();
  let attestationNonce = 1n;
  const sameAddress = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

  const makeSetVerifierAttestationRef = async (deepFamily, proofSystemId, purpose, verifier) => {
    const net = await ethers.provider.getNetwork();
    const actionDigest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "uint256", "address", "uint16", "address", "uint16", "uint8", "address"],
        [
          "DeepFamily.AttestationAction.V1",
          net.chainId,
          await deepFamily.getAddress(),
          4,
          deployer,
          proofSystemId,
          purpose,
          verifier,
        ],
      ),
    );
    const latestBlock = await ethers.provider.getBlock("latest");
    const nonce = attestationNonce++;
    return {
      attestationRefVersion: 1,
      subjectType: 6,
      subjectHash: actionDigest,
      actionType: 4,
      actionDigest,
      attestationPayloadDigest: ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "address", "uint256"],
          [actionDigest, deployer, nonce],
        ),
      ),
      signatureSuiteId: 1,
      signerKeyId: ethers.zeroPadValue(deployer, 32),
      uri: `ipfs://deploy-attestation-${nonce.toString()}`,
      issuedAt: Number(latestBlock.timestamp),
      expiresAt: Number(latestBlock.timestamp) + 3600,
      revocationType: 0,
      revocationRef: ethers.ZeroHash,
    };
  };

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

  const adultAgeGateDeployment = await deploy("AdultAgeGate", {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: network.live ? 2 : 1,
    redeployIfChanged: true,
  });

  log(`AdultAgeGate library deployed at: ${adultAgeGateDeployment.address}`);

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

  // 5) Deploy the attestation registry before the business contract can anchor references.
  const attestationRegistryDeployment = await deploy("DeepFamilyAttestationRegistry", {
    from: deployer,
    args: [],
    log: true,
    waitConfirmations: network.live ? 2 : 1,
    redeployIfChanged: true,
  });

  // 6) Deploy DeepFamily with PoseidonT5 linked
  const deepFamilyDeployment = await deploy("DeepFamily", {
    from: deployer,
    args: [tokenDeployment.address, attestationRegistryDeployment.address],
    libraries: {
      PoseidonT5: poseidonT5Deployment.address,
      AdultAgeGate: adultAgeGateDeployment.address,
    },
    log: true,
    waitConfirmations: network.live ? 2 : 1,
    redeployIfChanged: true,
  });
  const deepFamily = await ethers.getContractAt("DeepFamily", deepFamilyDeployment.address);
  const configuredRegistry = await deepFamily.ATTESTATION_REGISTRY();
  if (!sameAddress(configuredRegistry, attestationRegistryDeployment.address)) {
    throw new Error(
      `DeepFamily.ATTESTATION_REGISTRY is ${configuredRegistry}, ` +
        `expected ${attestationRegistryDeployment.address}.`,
    );
  }

  const attestationRegistry = await ethers.getContractAt(
    "DeepFamilyAttestationRegistry",
    attestationRegistryDeployment.address,
  );
  const boundDeepFamily = await attestationRegistry.deepFamily();
  if (boundDeepFamily === ethers.ZeroAddress) {
    const tx = await attestationRegistry.bindDeepFamily(deepFamilyDeployment.address);
    await tx.wait();
    log("DeepFamilyAttestationRegistry bound");
  } else if (!sameAddress(boundDeepFamily, deepFamilyDeployment.address)) {
    throw new Error(
      `DeepFamilyAttestationRegistry is already bound to ${boundDeepFamily}, ` +
        `but this deployment resolved DeepFamily to ${deepFamilyDeployment.address}. ` +
        "Redeploy registry/main/reader as a fresh module set.",
    );
  }

  // 7) Deploy reader aggregation contract after the main contract exists.
  const readerDeployment = await deploy("DeepFamilyReader", {
    from: deployer,
    args: [deepFamilyDeployment.address],
    log: true,
    waitConfirmations: network.live ? 2 : 1,
    redeployIfChanged: true,
  });
  log(`DeepFamilyReader deployed at: ${readerDeployment.address}`);
  const deepFamilyReader = await ethers.getContractAt("DeepFamilyReader", readerDeployment.address);
  const readerMain = await deepFamilyReader.DEEP_FAMILY();
  if (!sameAddress(readerMain, deepFamilyDeployment.address)) {
    throw new Error(
      `DeepFamilyReader.DEEP_FAMILY is ${readerMain}, expected ${deepFamilyDeployment.address}.`,
    );
  }

  // 8) Initialize the DeepFamilyToken contract (set DeepFamily address)
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
  } else {
    const bound = await deepFamilyToken.deepFamilyContract();
    if (!sameAddress(bound, deepFamilyDeployment.address)) {
      throw new Error(
        `DeepFamilyToken is already initialized with ${bound}, ` +
          `but this deployment resolved DeepFamily to ${deepFamilyDeployment.address}. ` +
          "Redeploy token/main as a fresh module set.",
      );
    }
  }

  // 9) Register the Groth16 adapter under PROOF_SYSTEM_ID_GROTH16_BN254_V1 = 1
  //    for both purposes (PersonCommitment = 0, DisclosureBinding = 1). Phase 2 routes business
  //    entrypoints to the adapter, which internally dispatches to the backend verifiers.
  const tx1 = await deepFamily.setVerifier(
    1,
    0,
    groth16AdapterDeployment.address,
    await makeSetVerifierAttestationRef(deepFamily, 1, 0, groth16AdapterDeployment.address),
  );
  await tx1.wait();
  log(`Groth16VerifierAdapter registered for (proofSystemId=1, purpose=PersonCommitment)`);

  const tx2 = await deepFamily.setVerifier(
    1,
    1,
    groth16AdapterDeployment.address,
    await makeSetVerifierAttestationRef(deepFamily, 1, 1, groth16AdapterDeployment.address),
  );
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
  "AdultAgeGate",
  "DeepFamilyAttestationRegistry",
  "DeepFamilyReader",
  "Integrated",
];
