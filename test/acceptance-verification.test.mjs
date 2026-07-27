import { expect } from "chai";
import { verifyAcceptanceContracts } from "../scripts/lib/acceptanceVerification.mjs";

const address = (suffix) => `0x${suffix.toString(16).padStart(40, "0")}`;

describe("multi-chain acceptance source verification", function () {
  it("verifies entries sequentially and returns only public result metadata", async () => {
    const calls = [];
    const hre = { marker: "hre" };
    const secretConstructorData = `0x${"ab".repeat(96)}`;
    const entries = [
      {
        label: "first",
        address: address(1),
        contract: "contracts/First.sol:First",
        constructorArgs: [secretConstructorData],
        libraries: { Library: address(9) },
      },
      {
        label: "second",
        address: address(2),
        contract: "contracts/Second.sol:Second",
      },
    ];

    const results = await verifyAcceptanceContracts({
      hre,
      entries,
      timeoutMs: 1_000,
      retries: 0,
      logger: null,
      verifyFn: async (args, receivedHre) => {
        calls.push({ args, receivedHre });
        return true;
      },
    });

    expect(calls.map((call) => call.args.address)).to.deep.equal([address(1), address(2)]);
    expect(calls[0].args).to.deep.include({
      address: address(1),
      contract: "contracts/First.sol:First",
      provider: "etherscan",
    });
    expect(calls[0].args.constructorArgs).to.deep.equal([secretConstructorData]);
    expect(calls[0].receivedHre).to.equal(hre);
    expect(calls[1].args.constructorArgs).to.deep.equal([]);
    expect(calls[1].args.libraries).to.deep.equal({});
    expect(results).to.deep.equal([
      {
        label: "first",
        address: address(1),
        contract: "contracts/First.sol:First",
        status: "passed",
        attempts: 1,
      },
      {
        label: "second",
        address: address(2),
        contract: "contracts/Second.sol:Second",
        status: "passed",
        attempts: 1,
      },
    ]);
    expect(JSON.stringify(results)).not.to.include(secretConstructorData);
  });

  it("forwards the selected Blockscout provider without requiring an API key", async () => {
    const calls = [];
    const results = await verifyAcceptanceContracts({
      hre: {},
      entries: [{ label: "sepolia", address: address(32), contract: "A.sol:A" }],
      timeoutMs: 1_000,
      retries: 0,
      logger: null,
      verificationProvider: "blockscout",
      explorerName: "Blockscout",
      verifyFn: async (args) => {
        calls.push(args);
        return true;
      },
    });

    expect(calls).to.have.length(1);
    expect(calls[0]).to.include({ provider: "blockscout" });
    expect(results[0]).to.include({ status: "passed", attempts: 1 });
  });

  it("treats ConfluxScan's already_verified machine status as passed", async () => {
    const results = await verifyAcceptanceContracts({
      hre: {},
      entries: [{ label: "existing", address: address(3), contract: "A.sol:A" }],
      timeoutMs: 1_000,
      retries: 0,
      logger: null,
      verifyFn: async () => {
        throw new Error(
          'HHE80024: status polling failed: "already_verified:The contract is already verified"',
        );
      },
    });

    expect(results[0]).to.include({ status: "passed", attempts: 1 });
  });

  it("does not trust a free-form already-verified-like error", async () => {
    let caught;
    try {
      await verifyAcceptanceContracts({
        hre: {},
        entries: [{ label: "ambiguous", address: address(31), contract: "A.sol:A" }],
        timeoutMs: 1_000,
        retries: 0,
        logger: null,
        verifyFn: async () => {
          throw new Error("the contract may already be verified, but the explorer is unavailable");
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.an("error");
    expect(caught.results[0]).to.include({ status: "failed", attempts: 1 });
  });

  it("does not accept a false verifier result as success", async () => {
    let caught;
    try {
      await verifyAcceptanceContracts({
        hre: {},
        entries: [{ label: "false-result", address: address(30), contract: "A.sol:A" }],
        timeoutMs: 1_000,
        retries: 0,
        logger: null,
        verifyFn: async () => false,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.an("error");
    expect(caught.results[0]).to.include({ status: "failed", attempts: 1 });
  });

  it("retries with finite exponential backoff and can recover", async () => {
    let attempts = 0;
    const delays = [];
    const messages = [];
    const sensitiveHex = `0x${"cd".repeat(32)}`;

    const results = await verifyAcceptanceContracts({
      hre: {},
      entries: [{ label: "retry", address: address(4), contract: "B.sol:B" }],
      timeoutMs: 5_000,
      retries: 2,
      logger: (message) => messages.push(message),
      sleepFn: async (delayMs) => delays.push(delayMs),
      verifyFn: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error(`explorer rejected payload ${sensitiveHex}`);
        return true;
      },
    });

    expect(attempts).to.equal(3);
    expect(delays).to.deep.equal([1_000, 2_000]);
    expect(results[0]).to.include({ status: "passed", attempts: 3 });
    expect(messages.join("\n")).not.to.include(sensitiveHex);
    expect(messages.join("\n")).to.include("<redacted-hex-data>");
  });

  it("collects later results, sanitizes final failures, and attaches them to the error", async () => {
    const sensitiveHex = `0x${"ef".repeat(65)}`;
    const sensitiveUrl = "https://rpc-user:rpc-password@example.invalid/path?token=secret";
    let caught;
    try {
      await verifyAcceptanceContracts({
        hre: {},
        entries: [
          { label: "broken", address: address(5), contract: "C.sol:C" },
          { label: "healthy", address: address(6), contract: "D.sol:D" },
        ],
        timeoutMs: 5_000,
        retries: 1,
        logger: null,
        sleepFn: async () => {},
        verifyFn: async ({ address: target }) => {
          if (target === address(5)) {
            throw new Error(`bad calldata ${sensitiveHex} via ${sensitiveUrl}`);
          }
          return true;
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.an("error");
    expect(caught.results).to.have.length(2);
    expect(caught.results[0]).to.include({ status: "failed", attempts: 2 });
    expect(caught.results[0].error).to.include("<redacted-hex-data>");
    expect(caught.results[0].error).to.include("<redacted-url>");
    expect(caught.results[1]).to.include({ status: "passed", attempts: 1 });
    expect(JSON.stringify(caught.results)).not.to.include(sensitiveHex);
    expect(JSON.stringify(caught.results)).not.to.include(sensitiveUrl);
  });

  it("bounds a hung explorer request and a hung retry delay", async () => {
    const startedAt = Date.now();
    let caught;
    try {
      await verifyAcceptanceContracts({
        hre: {},
        entries: [{ label: "hung", address: address(7), contract: "E.sol:E" }],
        timeoutMs: 40,
        attemptTimeoutMs: 5,
        retries: 2,
        logger: null,
        verifyFn: async () => new Promise(() => {}),
        sleepFn: async () => new Promise(() => {}),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.an("error");
    expect(Date.now() - startedAt).to.be.lessThan(500);
    expect(caught.results[0].status).to.equal("failed");
  });

  it("rejects unbounded or malformed configuration before verification", async () => {
    const base = {
      hre: {},
      entries: [{ label: "one", address: address(8), contract: "F.sol:F" }],
      logger: null,
      verifyFn: async () => true,
    };

    for (const args of [
      { ...base, timeoutMs: 0 },
      { ...base, timeoutMs: 1_000, retries: -1 },
      { ...base, timeoutMs: 1_000, retries: 11 },
      { ...base, timeoutMs: 1_000, entries: [{ label: "", address: address(8), contract: "F" }] },
      {
        ...base,
        timeoutMs: 1_000,
        entries: [{ label: "one", address: address(8), contract: "F", constructorArgs: {} }],
      },
      { ...base, timeoutMs: 1_000, verificationProvider: "unknown" },
    ]) {
      let caught;
      try {
        await verifyAcceptanceContracts(args);
      } catch (error) {
        caught = error;
      }
      expect(caught).to.be.an("error");
    }
  });
});
