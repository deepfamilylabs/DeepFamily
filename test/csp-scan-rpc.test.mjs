import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import { Contract, Interface, JsonRpcProvider, ZeroAddress } from "ethers";
import { verifyShieldedIdentityAuthorizationWitness } from "@deepfamily/protocol-core";
import { createCspScanRpcFixture } from "../frontend/scripts/lib/cspScanRpcFixture.mjs";

const artifact = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../frontend/src/abi/${name}.json`, import.meta.url), "utf8"));
const request = (id, method, params = []) => ({ jsonrpc: "2.0", id, method, params });

describe("CSP scan controlled RPC fixture", function () {
  let fixture;
  beforeEach(function () {
    fixture = createCspScanRpcFixture();
  });

  it("provides a complete public worker scope and a deterministic future expiry", function () {
    assert.equal(fixture.context.chainId, "31337");
    assert.equal(fixture.context.stateReadMode, "rebuild");
    assert.equal(fixture.context.assetKind, "native");
    assert.equal(fixture.context.factoryDeploymentBlock, 1);
    assert.equal(fixture.context.poolDeploymentBlock, 1);
    assert.equal(fixture.context.rpcUrl, undefined);
    assert.equal(
      new Set([
        fixture.context.factoryAddress,
        fixture.context.familyAddress,
        fixture.context.lineageIndexAddress,
        fixture.context.poolAddress,
        fixture.context.lettersAddress,
        fixture.authorizationStateAddress,
      ]).size,
      6,
    );
    assert.equal(BigInt(fixture.expiresAt) - BigInt(fixture.asOf), 86_400n);
  });

  it("serves real ABI readers and a root-authenticated empty authorization witness", async function () {
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(fixture.handle(JSON.parse(body))));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const provider = new JsonRpcProvider(`http://127.0.0.1:${server.address().port}`, undefined, {
      cacheTimeout: -1,
    });
    try {
      const { context } = fixture;
      const factory = new Contract(
        context.factoryAddress,
        artifact("ShieldedPoolFactory").abi,
        provider,
      );
      const family = new Contract(context.familyAddress, artifact("DeepFamily").abi, provider);
      const pool = new Contract(context.poolAddress, artifact("ShieldedNativePool").abi, provider);
      const archive = new Contract(
        context.lettersAddress,
        artifact("PrivateLetterArchive").abi,
        provider,
      );
      const authorization = new Contract(
        fixture.authorizationStateAddress,
        artifact("IdentityAuthorizationState").abi,
        provider,
      );
      assert.equal((await provider.getNetwork()).chainId, 31337n);
      const latest = await provider.getBlock(await provider.getBlockNumber());
      const deployment = await provider.getBlock(1);
      assert.equal(latest.number, 12);
      assert.equal(BigInt(latest.timestamp), BigInt(fixture.asOf));
      assert.notEqual(latest.hash, deployment.hash);
      assert.equal((await provider.getBlock(12)).hash, latest.hash);
      assert.equal(await factory.AUTHORIZATION_STATE(), fixture.authorizationStateAddress);
      assert.equal(await factory.LINEAGE_INDEX(), context.lineageIndexAddress);
      assert.equal(await family.lineageIndex(), context.lineageIndexAddress);
      assert.equal(await factory.poolFor(ZeroAddress), context.poolAddress);
      assert.equal(await pool.protocolVersion(), 1n);
      assert.equal(await pool.assetKind(), 1n);
      assert.equal(await pool.LINEAGE_INDEX(), context.lineageIndexAddress);
      assert.equal(await pool.VERIFIER(), await factory.VERIFIER());
      assert.equal(await pool.AUTHORIZATION_STATE(), fixture.authorizationStateAddress);
      assert.equal(await archive.POOL_FACTORY(), context.factoryAddress);
      assert.equal(await archive.AUTHORIZATION_STATE(), fixture.authorizationStateAddress);
      const tag = { blockTag: 12 };
      assert.equal(await authorization.creationBlock(tag), 1n);
      const header = await authorization.getStateSnapshotHeader(tag);
      assert.deepEqual(Array.from(header), [1n, 0n, 0n, 0n, 1n]);
      assert.equal(await authorization.currentRoot(tag), header.root);
      assert.equal(await authorization.currentCheckpointId(tag), header.checkpointId);
      const checkpoint = await authorization.getCheckpoint(header.checkpointId, tag);
      assert.equal(checkpoint.root, 0n);
      assert(checkpoint.createdAt <= BigInt(latest.timestamp));
      assert.equal(checkpoint.retiredAt, 0n);
      const alias = 123n;
      const proof = await authorization.getCounterProof(alias, tag);
      const witness = verifyShieldedIdentityAuthorizationWitness(
        {
          authorizationAlias: alias,
          authorizationCounter: proof.authorizationCounter,
          stateRoot: proof.stateRoot,
          depth: proof.depth,
          siblings: Array.from(proof.siblings),
          oldKey: proof.oldKey,
          oldValue: proof.oldValue,
          isOld0: proof.isOld0 ? 1n : 0n,
          absent: proof.absent ? 1n : 0n,
        },
        header.root,
        alias,
      );
      assert.equal(witness.authorizationCounter, 0n);
      assert.equal(witness.absent, 1n);
      const logs = await authorization.queryFilter(
        authorization.filters.CounterIncremented(),
        1,
        12,
      );
      assert.deepEqual(logs, []);
      assert.deepEqual(fixture.errors, []);
      assert(fixture.calls.some((call) => call.method === "eth_getLogs"));
      assert(fixture.calls.some((call) => call.method === "eth_call" && call.blockNumber === 12));
    } finally {
      provider.destroy();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("keeps batch request IDs and fails unsupported methods without fabricating results", function () {
    const responses = fixture.handle([
      request("chain", "eth_chainId"),
      request(2, "eth_sendRawTransaction", ["0x1234"]),
      request(3, "eth_blockNumber"),
    ]);
    assert.equal(responses[0].id, "chain");
    assert.equal(responses[0].result, "0x7a69");
    assert.equal(responses[1].id, 2);
    assert.equal(responses[1].error.code, -32601);
    assert.equal(responses[1].result, undefined);
    assert.equal(responses[2].result, "0xc");
    assert.equal(fixture.errors.length, 1);
    assert.equal(JSON.stringify(fixture.errors).includes("0x1234"), false);
  });

  it("rejects unknown contracts, selectors, checkpoints and block anchors", function () {
    const authorization = new Interface(artifact("IdentityAuthorizationState").abi);
    const calls = [
      request(1, "eth_call", [{ to: ZeroAddress, data: "0x12345678" }, "latest"]),
      request(2, "eth_call", [
        { to: fixture.authorizationStateAddress, data: "0x12345678" },
        "latest",
      ]),
      request(3, "eth_call", [
        {
          to: fixture.authorizationStateAddress,
          data: authorization.encodeFunctionData("getCheckpoint", [2n]),
        },
        "0xc",
      ]),
      request(4, "eth_getBlockByNumber", ["0xd", false]),
      request(5, "eth_call", [
        {
          to: fixture.authorizationStateAddress,
          data: authorization.encodeFunctionData("currentRoot"),
        },
        "pending",
      ]),
      request(6, "eth_getLogs", [
        { address: ZeroAddress, topics: [], fromBlock: "0x1", toBlock: "0xc" },
      ]),
    ];
    const responses = fixture.handle(calls);
    for (const response of responses) {
      assert.equal(response.result, undefined);
      assert.equal(response.error.code, -32602);
    }
    assert.equal(fixture.errors.length, calls.length);
  });

  it("rejects invalid JSON-RPC envelopes and invalid empty batches", function () {
    for (const value of [
      null,
      {},
      [],
      request(null, "eth_chainId"),
      request(1, "eth_chainId", {}),
    ]) {
      const result = fixture.handle(value);
      assert.equal(result.result, undefined);
      assert.equal(result.error.code, -32602);
    }
    assert.throws(() => createCspScanRpcFixture({ timestamp: Number.NaN }), /timestamp/u);
  });
});
