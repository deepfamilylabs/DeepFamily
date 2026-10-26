import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { poseidon2 } from "poseidon-lite";
import { replayLineageTree } from "@deepfamily/protocol-core";

// These tests isolate state-machine/input binding with explicitly labelled mock verifiers.
// The real circuits and generated Groth16 verifiers have separate integration tests.
describe(" receive registry", function () {
  const abi = hre.ethers.AbiCoder.defaultAbiCoder();
  const proof = (signals) => abi.encode(["uint256[]"], [signals]);

  async function setup() {
    const t3 = await (await hre.ethers.getContractFactory("PoseidonT3")).deploy();
    const source = await (
      await hre.ethers.getContractFactory("EligibilitySourceMock", {
        libraries: { PoseidonT3: await t3.getAddress() },
      })
    ).deploy();
    const verifier = await (await hre.ethers.getContractFactory("FixedProofVerifierMock")).deploy();
    const registry = await (
      await hre.ethers.getContractFactory("ReceiveRegistry", {
        libraries: { PoseidonT3: await t3.getAddress() },
      })
    ).deploy(await source.getAddress(), ...Array(3).fill(await verifier.getAddress()));
    const scope = BigInt(await registry.getAddress());
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    const code = {
      codeAlias: 11n,
      commonBinding: 12n,
      revocationTag: poseidon2([74021n, 99n]),
      nonce: 13n,
      ownerCommitment: 14n,
      viewKeyLo: 15n,
      viewKeyHi: 16n,
      expiresAt: BigInt((await hre.ethers.provider.getBlock("latest")).timestamp) + 3600n,
    };
    const codeSignals = (item = code) => [
      item.codeAlias,
      item.commonBinding,
      item.revocationTag,
      chainId,
      scope,
      item.nonce,
      item.ownerCommitment,
      item.viewKeyLo,
      item.viewKeyHi,
      item.expiresAt,
    ];
    const issue = async (credential) => {
      const facts = await source.sourceRoot();
      const trust = await source.trustedRoot();
      return registry.registerCredential(
        credential,
        facts,
        trust,
        proof([credential, chainId, scope, facts, trust]),
      );
    };
    return { source, registry, code, codeSignals, issue, scope, chainId };
  }

  it("issues only against current authenticated roots and preserves historical issuance roots", async () => {
    const { registry, source, issue, scope, chainId } = await setup();
    const writes = [];
    const roots = [];
    for (let index = 0; index < 9; ++index) {
      const credential = BigInt(index + 1000);
      await issue(credential);
      writes.push({ leafIndex: BigInt(index), leaf: credential });
      const tree = replayLineageTree(writes);
      roots.push(tree.root);
      expect(await registry.issuanceRoot()).to.equal(tree.root);
      expect(await registry.credentialCount()).to.equal(BigInt(index + 1));
      for (let leafIndex = 0; leafIndex <= index; ++leafIndex) {
        const expected = tree.generateProof(leafIndex);
        const actual = await registry.getCredentialProof(leafIndex);
        expect(actual.leaf).to.equal(expected.leaf);
        expect(actual.root).to.equal(expected.root);
        expect(actual.index).to.equal(BigInt(expected.index));
        expect(actual.depth).to.equal(BigInt(expected.siblings.length));
        expect([...actual.siblings]).to.deep.equal(expected.siblings);
      }
    }
    for (const root of roots) expect(await registry.isKnownIssuanceRoot(root)).to.equal(true);
    expect(await registry.isKnownIssuanceRoot(0)).to.equal(false);
    await expect(issue(1000n)).to.be.revertedWithCustomError(registry, "DuplicateCredential");
    await source.setRoots(201, 202);
    await expect(
      registry.registerCredential(999n, 101n, 102n, proof([999n, chainId, scope, 101n, 102n])),
    ).to.be.revertedWithCustomError(registry, "StaleSourceRoot");
    await expect(
      registry.registerCredential(999n, 201n, 202n, proof([998n, chainId, scope, 201n, 202n])),
    ).to.be.revertedWithCustomError(registry, "InvalidProof");
    expect(await registry.credentialCount()).to.equal(9n);
    await issue(999n);
    expect([...(await registry.getCredentialPage(8, 4))]).to.deep.equal([1008n, 999n]);
  });

  it("validates generic codes without a family credential and binds every public field and scope", async () => {
    const { registry, code, codeSignals } = await setup();
    const valid = proof(codeSignals());
    expect(await registry.verifyReceive(code, valid)).to.equal(true);
    for (const name of Object.keys(code)) {
      const altered = { ...code, [name]: code[name] + 1n };
      await expect(registry.verifyReceive(altered, valid)).to.be.revertedWithCustomError(
        registry,
        "InvalidProof",
      );
    }
    const wrongChain = codeSignals();
    wrongChain[3] += 1n;
    await expect(registry.verifyReceive(code, proof(wrongChain))).to.be.revertedWithCustomError(
      registry,
      "InvalidProof",
    );
    const wrongScope = codeSignals();
    wrongScope[4] += 1n;
    await expect(registry.verifyReceive(code, proof(wrongScope))).to.be.revertedWithCustomError(
      registry,
      "InvalidProof",
    );
    await expect(
      registry.verifyReceive({ ...code, viewKeyLo: 1n << 128n }, valid),
    ).to.be.revertedWithCustomError(registry, "InvalidField");
    await expect(
      registry.verifyReceive({ ...code, codeAlias: await registry.SNARK_SCALAR_FIELD() }, valid),
    ).to.be.revertedWithCustomError(registry, "InvalidField");
  });

  it("rechecks all current roles while keeping ordinary receive independent of family revocation", async () => {
    for (const role of [0, 1, 2]) {
      const { registry, source, code, codeSignals, issue, scope, chainId } = await setup();
      await issue(301n);
      const secrets = [701n, 702n, 703n];
      const indices = secrets.map((secret, index) => poseidon2([74321n + BigInt(index), secret]));
      const capability = {
        issuanceRoot: await registry.issuanceRoot(),
        parentVersion: 1n,
        capabilityBinding: 401n,
        familyTag: 402n,
        childRoleIndex: indices[0],
        endorsementRoleIndex: indices[1],
        trustedRoleIndex: indices[2],
      };
      const signals = [
        401n,
        402n,
        ...indices,
        chainId,
        scope,
        capability.issuanceRoot,
        code.commonBinding,
        1n,
      ];
      const call = (item = capability, capProof = proof(signals)) =>
        registry.verifyBudgetCapability(code, item, proof(codeSignals()), capProof);
      expect(await call()).to.equal(true);
      await issue(302n); // The old code remains valid after unrelated registrations.
      expect(await call()).to.equal(true);
      await expect(call({ ...capability, parentVersion: 2n })).to.be.revertedWithCustomError(
        registry,
        "InvalidProof",
      );
      await expect(call({ ...capability, issuanceRoot: 999n })).to.be.revertedWithCustomError(
        registry,
        "UnknownIssuanceRoot",
      );
      for (const field of ["childRoleIndex", "endorsementRoleIndex", "trustedRoleIndex"]) {
        // A different, currently unrevoked index is not interchangeable with the
        // qualification authenticated by the capability proof.
        await expect(
          call({ ...capability, [field]: capability[field] + 1n }),
        ).to.be.revertedWithCustomError(registry, "InvalidProof");
      }
      const anotherCode = {
        ...code,
        codeAlias: code.codeAlias + 10n,
        nonce: code.nonce + 10n,
        commonBinding: code.commonBinding + 10n,
      };
      const anotherSignals = [...signals];
      anotherSignals[8] = anotherCode.commonBinding;
      const anotherCall = () =>
        registry.verifyBudgetCapability(
          anotherCode,
          capability,
          proof(codeSignals(anotherCode)),
          proof(anotherSignals),
        );
      expect(await anotherCall()).to.equal(true);
      expect(await registry.validateBudgetRoleStatus(capability.issuanceRoot, ...indices)).to.equal(
        true,
      );
      await source.revokeRole(role, secrets[role]);
      await expect(call())
        .to.be.revertedWithCustomError(registry, "QualificationRevoked")
        .withArgs(role);
      await expect(anotherCall())
        .to.be.revertedWithCustomError(registry, "QualificationRevoked")
        .withArgs(role);
      await expect(registry.validateBudgetRoleStatus(capability.issuanceRoot, ...indices))
        .to.be.revertedWithCustomError(registry, "QualificationRevoked")
        .withArgs(role);
      expect(await registry.verifyReceive(code, proof(codeSignals()))).to.equal(true);
    }
  });

  it("expires and revokes an individual code, without revoking unrelated codes", async () => {
    const { registry, code, codeSignals } = await setup();
    await registry.revokeCode(98n);
    expect(await registry.verifyReceive(code, proof(codeSignals()))).to.equal(true);
    await registry.revokeCode(99n);
    expect(await registry.isCodeRevoked(code.revocationTag)).to.equal(true);
    await expect(registry.verifyReceive(code, proof(codeSignals()))).to.be.revertedWithCustomError(
      registry,
      "CodeRevoked",
    );
    await expect(registry.revokeCode(99n)).to.be.revertedWithCustomError(registry, "CodeRevoked");
    const fresh = await setup();
    await hre.networkHelpers.time.increaseTo(fresh.code.expiresAt);
    await expect(
      fresh.registry.verifyReceive(fresh.code, proof(fresh.codeSignals())),
    ).to.be.revertedWithCustomError(fresh.registry, "CodeExpired");
  });
});
