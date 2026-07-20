import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import disclosureBindingProof from "../lib/disclosureBindingProof.js";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import {
  addPerson,
  buildPersonCommitmentCircuitInput,
  computeProfileIdentityCommitment,
  makeAddPersonPublicSignals,
  makeStubProof,
  makeTestPerson,
  setupStubVerifiers,
} from "./helpers/testHelper.mjs";

const { buildDisclosureBindingInput } = disclosureBindingProof;

const PURPOSE_PERSON = 0;
const PURPOSE_DISCLOSURE_BINDING = 1;
const FALSE_PROOF_SYSTEM_ID = 900;
const MISSING_PROOF_SYSTEM_ID = 901;
const UPDATED_PROOF_SYSTEM_ID = 902;

async function deployStubAdapter({
  personShouldVerify = true,
  disclosureShouldVerify = true,
} = {}) {
  const personStubFactory = await hre.ethers.getContractFactory(
    "contracts/test/StubPersonCommitmentVerifier.sol:StubPersonCommitmentVerifier",
  );
  const personVerifier = await personStubFactory.deploy(personShouldVerify);
  await personVerifier.waitForDeployment();

  const disclosureStubFactory = await hre.ethers.getContractFactory(
    "contracts/test/StubDisclosureBindingVerifier.sol:StubDisclosureBindingVerifier",
  );
  const disclosureVerifier = await disclosureStubFactory.deploy(disclosureShouldVerify);
  await disclosureVerifier.waitForDeployment();

  const adapterFactory = await hre.ethers.getContractFactory("Groth16VerifierAdapter");
  const adapter = await adapterFactory.deploy(
    await personVerifier.getAddress(),
    await disclosureVerifier.getAddress(),
  );
  await adapter.waitForDeployment();

  return { adapter, personVerifier, disclosureVerifier };
}

function makeDisclosureCoreInfo(identityCommitment, fullName, person) {
  return {
    basicInfo: {
      identityCommitment: hre.ethers.zeroPadValue(hre.ethers.toBeHex(identityCommitment), 32),
      isBirthBC: Boolean(person.isBirthBC),
      birthYear: Number(person.birthYear ?? 0),
      birthMonth: Number(person.birthMonth ?? 0),
      birthDay: Number(person.birthDay ?? 0),
      gender: Number(person.gender ?? 0),
    },
    supplementInfo: {
      fullName,
      birthPlace: "",
      isDeathBC: false,
      deathYear: 0,
      deathMonth: 0,
      deathDay: 0,
      deathPlace: "",
      story: "",
    },
  };
}

async function buildAddPersonAttempt(signer, opts = {}) {
  const signerAddr = await signer.getAddress();
  const person = makeTestPerson(opts.fullName ?? "Transport Add Person", opts.personOverrides);
  const built = buildPersonCommitmentCircuitInput(person, null, null, signerAddr, opts.meta);

  return {
    person,
    built,
    proof: {
      ...makeStubProof(),
      ...opts.proofOverrides,
    },
    publicSignals: makeAddPersonPublicSignals(
      built.person.identityCommitment,
      signerAddr,
      opts.meta,
    ),
  };
}

async function buildMintAttempt(deepFamily, signer, opts = {}) {
  const fullName = opts.fullName ?? "Transport Mint Person";
  const person = makeTestPerson(fullName, opts.personOverrides);
  const identityCommitment = computeProfileIdentityCommitment(hre.ethers, person, opts.meta);
  const personHash = await addPerson(hre.ethers, deepFamily, signer, identityCommitment, {
    person,
    ...(opts.meta ?? {}),
  });
  await deepFamily.connect(signer).endorseVersion(personHash, 1);

  const signerAddr = await signer.getAddress();
  const built = buildDisclosureBindingInput(person, signerAddr, opts.meta);

  return {
    person,
    personHash,
    built,
    proof: {
      ...makeStubProof(),
      ...opts.proofOverrides,
    },
    publicSignals: {
      identityCommitment: built.person.identityCommitment,
      disclosureBinding: built.disclosureBinding,
      minter: BigInt(built.input.minter),
      schemaVersion: built.input.schemaVersion,
      cryptoSuiteVersion: built.input.cryptoSuiteVersion,
      hashAlgoId: built.input.hashAlgoId,
    },
    coreInfo: makeDisclosureCoreInfo(
      built.person.identityCommitment,
      built.canonicalFullName,
      person,
    ),
  };
}

describe("Proof transport layer tests", function () {
  this.timeout(120_000);

  describe("Groth16VerifierAdapter guards", () => {
    it("rejects unsupported proof encoding", async () => {
      const { adapter } = await deployStubAdapter();
      const proof = makeStubProof();

      await expect(
        adapter.verifyProof(PURPOSE_PERSON, 255, proof.proofData, Array(7).fill(0)),
      ).to.be.revertedWithCustomError(adapter, "UnsupportedProofEncoding");
    });

    it("rejects malformed proof payload length", async () => {
      const { adapter } = await deployStubAdapter();

      await expect(
        adapter.verifyProof(PURPOSE_PERSON, 1, "0x1234", Array(7).fill(0)),
      ).to.be.revertedWithCustomError(adapter, "MalformedProofData");
    });

    it("rejects malformed person public-signal length", async () => {
      const { adapter } = await deployStubAdapter();
      const proof = makeStubProof();

      await expect(
        adapter.verifyProof(PURPOSE_PERSON, 1, proof.proofData, Array(6).fill(0)),
      ).to.be.revertedWithCustomError(adapter, "MalformedProofData");
    });

    it("rejects malformed disclosure public-signal length", async () => {
      const { adapter } = await deployStubAdapter();
      const proof = makeStubProof();

      await expect(
        adapter.verifyProof(PURPOSE_DISCLOSURE_BINDING, 1, proof.proofData, Array(7).fill(0)),
      ).to.be.revertedWithCustomError(adapter, "MalformedProofData");
    });
  });

  describe("DeepFamily proof-route failures", () => {
    it("allows only the owner to update a verifier route and emits the update", async () => {
      const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
      const [, nonOwner] = await hre.ethers.getSigners();
      const { adapter } = await deployStubAdapter();
      const adapterAddress = await adapter.getAddress();

      await expect(
        deepFamily
          .connect(nonOwner)
          .setVerifier(UPDATED_PROOF_SYSTEM_ID, PURPOSE_PERSON, adapterAddress),
      )
        .to.be.revertedWithCustomError(deepFamily, "OwnableUnauthorizedAccount")
        .withArgs(await nonOwner.getAddress());

      await expect(deepFamily.setVerifier(UPDATED_PROOF_SYSTEM_ID, PURPOSE_PERSON, adapterAddress))
        .to.emit(deepFamily, "VerifierUpdated")
        .withArgs(UPDATED_PROOF_SYSTEM_ID, PURPOSE_PERSON, adapterAddress);

      expect(await deepFamily.verifierRegistry(UPDATED_PROOF_SYSTEM_ID, PURPOSE_PERSON)).to.equal(
        adapterAddress,
      );
    });

    it("rejects zero and codeless verifier address registration", async () => {
      const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
      const [, eoa] = await hre.ethers.getSigners();

      await expect(
        deepFamily.setVerifier(1, PURPOSE_PERSON, hre.ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidVerifierAddress");

      const eoaAddress = await eoa.getAddress();
      await expect(
        deepFamily.setVerifier(1, PURPOSE_PERSON, eoaAddress),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidVerifierAddress");
    });

    it("reverts addPersonVersion when verifier route is missing", async () => {
      const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
      const [signer] = await hre.ethers.getSigners();
      const attempt = await buildAddPersonAttempt(signer, {
        proofOverrides: { proofSystemId: MISSING_PROOF_SYSTEM_ID },
      });

      await expect(
        deepFamily
          .connect(signer)
          .addPersonVersion(
            attempt.proof,
            attempt.publicSignals,
            0,
            0,
            "missing-route",
            "ipfs://missing-route",
          ),
      ).to.be.revertedWithCustomError(deepFamily, "VerifierRouteNotSet");
    });

    it("maps adapter false to InvalidZKProof for addPersonVersion", async () => {
      const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
      const [signer] = await hre.ethers.getSigners();
      const { adapter } = await deployStubAdapter({ personShouldVerify: false });
      await deepFamily.setVerifier(
        FALSE_PROOF_SYSTEM_ID,
        PURPOSE_PERSON,
        await adapter.getAddress(),
      );

      const attempt = await buildAddPersonAttempt(signer, {
        proofOverrides: { proofSystemId: FALSE_PROOF_SYSTEM_ID },
      });

      await expect(
        deepFamily
          .connect(signer)
          .addPersonVersion(
            attempt.proof,
            attempt.publicSignals,
            0,
            0,
            "invalid-proof",
            "ipfs://invalid-proof",
          ),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidZKProof");
    });

    it("reverts mintPersonVersionNFT when verifier route is missing", async () => {
      const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
      const [signer] = await hre.ethers.getSigners();
      await setupStubVerifiers(hre.ethers, deepFamily);

      const attempt = await buildMintAttempt(deepFamily, signer, {
        proofOverrides: { proofSystemId: MISSING_PROOF_SYSTEM_ID },
      });

      await expect(
        deepFamily
          .connect(signer)
          .mintPersonVersionNFT(attempt.proof, attempt.publicSignals, 1, "", attempt.coreInfo),
      ).to.be.revertedWithCustomError(deepFamily, "VerifierRouteNotSet");
    });

    it("maps adapter false to InvalidZKProof for mintPersonVersionNFT", async () => {
      const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
      const [signer] = await hre.ethers.getSigners();
      await setupStubVerifiers(hre.ethers, deepFamily);

      const { adapter } = await deployStubAdapter({ disclosureShouldVerify: false });
      await deepFamily.setVerifier(
        FALSE_PROOF_SYSTEM_ID,
        PURPOSE_DISCLOSURE_BINDING,
        await adapter.getAddress(),
      );

      const attempt = await buildMintAttempt(deepFamily, signer, {
        proofOverrides: { proofSystemId: FALSE_PROOF_SYSTEM_ID },
      });

      await expect(
        deepFamily
          .connect(signer)
          .mintPersonVersionNFT(attempt.proof, attempt.publicSignals, 1, "", attempt.coreInfo),
      ).to.be.revertedWithCustomError(deepFamily, "InvalidZKProof");
    });
  });
});
