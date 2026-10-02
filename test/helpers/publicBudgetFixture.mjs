import hre from "hardhat";
import { buildShieldedPublicClaimPublicInputs } from "@deepfamily/protocol-core";
import { deployIntegratedSystem } from "../../hardhat/integratedDeployment.mjs";
import {
  makeStubProof,
  makeAddPersonPublicSignals,
  makeMetadataEnvelope,
  setupStubVerifiers,
} from "./testHelper.mjs";
import { buildShieldedClaimFixture } from "../../circuits/test/generate_shielded_claim_input.mjs";
import { buildShieldedPublicClaimFixture } from "../../circuits/test/generate_shielded_claim_public_input.mjs";

export const PUBLIC_PERIOD = 2_592_000n;
export const publicCiphertext = (byte) => `0x${byte.repeat(512)}`;

export async function deployPublicBudgetFixture(connection) {
  // Keep this fixture independent of the shared task deployment cache: EVM
  // snapshots restore contract state but cannot restore JavaScript cache objects.
  const system = await deployIntegratedSystem(connection, { writeDeployments: false });
  const [funder, other] = await hre.ethers.getSigners();
  await setupStubVerifiers(hre.ethers, system.deepFamily);
  const privateFixture = buildShieldedClaimFixture();
  const identityFixture = buildShieldedPublicClaimFixture();
  const rootIdentity = BigInt(privateFixture.witness.fatherIdentityCommitment);
  const heirIdentity = identityFixture.heirIdentityCommitment;
  const hashOf = (identity) =>
    hre.ethers.keccak256(hre.ethers.zeroPadValue(hre.ethers.toBeHex(identity), 32));
  const rootHash = hashOf(rootIdentity);
  const heirHash = hashOf(heirIdentity);
  await system.deepFamily.addPersonVersion(
    makeStubProof(),
    makeAddPersonPublicSignals(rootIdentity, funder.address, { tag: "public-root" }),
    0,
    0,
    makeMetadataEnvelope(hre.ethers, 1, { tag: "public-root" }),
  );
  const addHeirVersion = async (tag) =>
    system.deepFamily.addPersonVersion(
      makeStubProof(),
      makeAddPersonPublicSignals(heirIdentity, funder.address, {
        tag,
        fatherIdentityCommitment: rootIdentity,
        motherIdentityCommitment: BigInt(privateFixture.witness.motherIdentityCommitment),
      }),
      1,
      0,
      makeMetadataEnvelope(hre.ethers, 1, { tag }),
    );
  await addHeirVersion("public-child");
  await system.token.approve(await system.deepFamily.getAddress(), hre.ethers.MaxUint256);
  await system.deepFamily.endorseVersion(heirHash, 1);
  const token = await hre.ethers.deployContract("ShieldedPoolTokenMock");
  const verifier = await hre.ethers.deployContract("ShieldedPoolVerifierMock");
  const poolFactory = await hre.ethers.getContractFactory("ShieldedDeepPool", {
    libraries: { PoseidonT3: await system.poseidonT3.getAddress() },
  });
  const pool = await poolFactory.deploy(
    await token.getAddress(),
    await system.lineageIndex.getAddress(),
    await verifier.getAddress(),
  );
  await pool.waitForDeployment();
  for (const signer of [funder, other]) {
    await token.mint(signer.address, 10000n);
    await token.connect(signer).approve(await pool.getAddress(), hre.ethers.MaxUint256);
  }
  const funding = {
    budgetId: 0n,
    rootPersonHash: rootHash,
    rootVersionIndex: 1n,
    heirPersonHash: heirHash,
    amountPerPeriod: 100n,
    budgetPeriods: 3n,
    heirVersionIndex: 1n,
    endorser: funder.address,
  };
  const claim = {
    budgetId: 1n,
    firstPeriod: 0n,
    claimCount: 1,
    heirVersionIndex: 1n,
    endorser: funder.address,
    outputCommitments: [101n, 102n],
    outputCiphertexts: [publicCiphertext("01"), publicCiphertext("02")],
  };
  return {
    ...system,
    funder,
    other,
    token,
    verifier,
    pool,
    poolFactory,
    rootHash,
    heirHash,
    rootIdentity,
    heirIdentity,
    identityFixture,
    funding,
    claim,
    addHeirVersion,
  };
}

export async function publicClaimProof(pool, data, identity, amount) {
  const { signals } = buildShieldedPublicClaimPublicInputs({
    chainId: (await hre.ethers.provider.getNetwork()).chainId,
    poolAddress: await pool.getAddress(),
    ...data,
    heirIdentityCommitment: identity,
    amount,
  });
  return hre.ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "uint256[]"], [7, signals]);
}
