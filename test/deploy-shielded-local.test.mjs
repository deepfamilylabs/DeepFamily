import assert from "node:assert/strict";
import { assertLocalShieldedDevelopmentNetwork } from "../scripts/deploy-shielded-local.mjs";

const localConnection = (
  networkName = "localhost",
  chainId = 31337n,
  url = "http://127.0.0.1:8545",
) => ({
  networkName,
  networkConfig: { type: "http", url },
  ethers: {
    provider: {
      send: async () => `0x${chainId.toString(16)}`,
      getNetwork: async () => ({ chainId }),
    },
  },
});

describe("shielded localhost development deployment guard", () => {
  it("accepts only the named local chain before any deployment", async () => {
    await assert.doesNotReject(assertLocalShieldedDevelopmentNetwork(localConnection()));
    const resolvedConfig = localConnection();
    resolvedConfig.networkConfig.url = { get: async () => "http://127.0.0.1:8545" };
    await assert.doesNotReject(assertLocalShieldedDevelopmentNetwork(resolvedConfig));
    await assert.rejects(
      assertLocalShieldedDevelopmentNetwork(localConnection("confluxTestnet")),
      /named localhost network/,
    );
    await assert.rejects(
      assertLocalShieldedDevelopmentNetwork(localConnection("localhost", 71n)),
      /chain ID 31337/,
    );
    await assert.rejects(
      assertLocalShieldedDevelopmentNetwork(
        localConnection("localhost", 31337n, "https://example.org"),
      ),
      /local loopback HTTP/,
    );
  });
});
