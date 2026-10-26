import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import hre from "hardhat";
import { createReceiveRevocationGasFixture } from "./fixtures/receive-revocation-gas.mjs";

// Actual append-only contracts and Ethers transport; echo verifiers only create
// public tree records. Cryptographic acceptance has its separate real EVM suite.
describe("Receiving path migration against actual contracts", function () {
  this.timeout(120_000);

  it("returns the same Q and paired Source paths in both strategies, including incremental replay", async () => {
    const root = path.resolve(import.meta.dirname, "..");
    fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
    const directory = fs.mkdtempSync(path.join(root, "tmp/receive-path-migration-"));
    try {
      const output = path.join(directory, "receiveChain.mjs");
      await build({
        entryPoints: [path.join(root, "frontend/src/shared/clients/receiveChain.ts")],
        outfile: output, bundle: true, platform: "node", format: "esm",
        external: ["ethers", "@deepfamily/protocol-core"],
        define: { "import.meta.env": "{}" }, logLevel: "silent",
      });
      const { ReceiveChain } = await import(pathToFileURL(output).href);
      const fixture = await createReceiveRevocationGasFixture(hre);
      await fixture.seedTo(3);
      const registryAddress = await fixture.registry.getAddress();
      const abi = hre.ethers.AbiCoder.defaultAbiCoder();
      const issue = async credential => {
        const factRoot = await fixture.source.sourceRoot(), trustRoot = await fixture.source.trustedRoot();
        await (await fixture.registry.registerCredential(credential, factRoot, trustRoot,
          abi.encode(["uint256[]"], [[credential, fixture.chainId, BigInt(registryAddress), factRoot, trustRoot]]))).wait();
      };
      await issue(302n);
      await issue(303n);
      const deployment = { chainId: fixture.chainId, registryAddress,
        poolAddress: await fixture.pools[0].pool.getAddress() };
      const expected = value => ({ leaf: value.leaf, root: value.root, index: value.index,
        depth: value.depth, siblings: Array.from(value.siblings) });
      const local = new ReceiveChain(deployment, fixture.endorser, { stateReadMode: "rebuild" });
      const direct = new ReceiveChain(deployment, fixture.endorser, { stateReadMode: "chain" });
      const q = expected(await fixture.registry.getCredentialProof(2n));
      assert.deepEqual(await local.readCredentialProof(2n), q);
      assert.deepEqual(await direct.readCredentialProof(2n), q);
      const fact = expected(await fixture.source.getSourceProof(0, 2n));
      const trust = expected(await fixture.source.getSourceProof(1, 3n));
      for (const reader of [local, direct]) {
        const paths = await reader.readSourcePaths(2n, 3n);
        assert.deepEqual(paths.sourcePath, fact);
        assert.deepEqual(paths.trustedPath, trust);
        assert.equal(paths.sourceRoot, fact.root);
        assert.equal(paths.trustedRoot, trust.root);
        assert.equal(paths.sourceAddress.toLowerCase(), (await fixture.source.getAddress()).toLowerCase());
      }
      await issue(304n);
      const refreshed = expected(await fixture.registry.getCredentialProof(3n));
      assert.deepEqual(await local.readCredentialProof(3n), refreshed);
      assert.deepEqual(await direct.readCredentialProof(3n), refreshed);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
