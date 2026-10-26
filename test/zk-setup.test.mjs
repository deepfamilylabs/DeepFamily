import assert from "node:assert/strict";
import path from "node:path";
import { main, parseArguments, runZkSetup } from "../scripts/zk-setup.mjs";
import {
  CANONICAL_CIRCUIT_NAMES,
  PROTOCOL_CIRCUIT_NAMES,
  BOUNDARY_CIRCUIT_NAMES,
} from "../scripts/lib/zkCircuitSelection.mjs";

const root = path.resolve("/fixture/deepfamily");
function fixture(failingOperation) {
  const calls = [],
    artifacts = { status: "development", circuitCount: 13 };
  const failure = new Error("operation failed");
  const options = { root };
  for (const name of [
    "buildCore",
    "inspectIdentity",
    "buildProtocol",
    "setupProtocol",
    "buildBoundary",
    "setupBoundary",
    "check",
  ])
    options[name] = async (input) => {
      calls.push([name, input]);
      if (name === failingOperation) throw failure;
      return name === "check" ? artifacts : undefined;
    };
  return { options, calls, artifacts, failure };
}

describe("complete artifact setup workflow", function () {
  it("parses current catalogue selectors and an explicit shared Powers of Tau path", function () {
    assert.deepEqual(parseArguments([]), {
      help: false,
      circuit: "all",
      ptauPath: undefined,
    });
    assert.deepEqual(parseArguments(["--ptau", "local.ptau", "--circuit=shielded:unshield4"]), {
      help: false,
      circuit: "shielded:unshield4",
      ptauPath: "local.ptau",
    });
    assert.deepEqual(parseArguments(["--circuit", "protocol:claim", "--ptau=local.ptau"]), {
      help: false,
      circuit: "protocol:claim",
      ptauPath: "local.ptau",
    });
    for (const args of [
      ["--production"],
      ["--circuit"],
      ["--ptau="],
      ["--ptau", "--circuit", "core"],
      ["--circuit", "shielded:claim"],
      ["--circuit", "code"],
      ["--circuit", "core", "--circuit=person"],
      ["--ptau=a", "--ptau", "b"],
      ["--help", "--circuit", "core"],
    ])
      assert.throws(() => parseArguments(args), undefined, JSON.stringify(args));
  });

  it("compiles all 13, checks existing identity keys first, rotates only the 11 receiving and boundary sets and checks the full result", async function () {
    const { options, calls, artifacts } = fixture();
    const result = await runZkSetup({ ...options, ptauPath: "local.ptau" });
    const protocol = PROTOCOL_CIRCUIT_NAMES.map((name) => name.slice("protocol:".length));
    const boundaries = BOUNDARY_CIRCUIT_NAMES.map((name) => name.slice("shielded:".length));
    assert.deepEqual(calls, [
      ["buildCore", { root, circuit: "core" }],
      ["inspectIdentity", { root, requireBuiltR1cs: true }],
      ["buildProtocol", { root, circuits: protocol }],
      ["setupProtocol", { root, circuits: protocol, ptauPath: "local.ptau" }],
      ["buildBoundary", { root, circuits: boundaries }],
      ["setupBoundary", { root, circuits: boundaries, ptauPath: "local.ptau" }],
      ["check", { root }],
    ]);
    assert.deepEqual(result.circuits, CANONICAL_CIRCUIT_NAMES);
    assert.equal(result.regeneratedCircuits.length, 11);
    assert.ok(
      result.regeneratedCircuits.every(
        (name) => name.startsWith("protocol:") || name.startsWith("shielded:"),
      ),
    );
    assert.equal(result.artifacts, artifacts);
  });

  for (const [circuit, expected] of [
    ["protocol:claim", ["inspectIdentity", "buildProtocol", "setupProtocol", "check"]],
    ["shielded:unshield4", ["inspectIdentity", "buildBoundary", "setupBoundary", "check"]],
    ["core", ["buildCore", "inspectIdentity", "check"]],
    ["person", ["buildCore", "inspectIdentity", "check"]],
  ])
    it(`limits ${circuit} regeneration while retaining the complete final check`, async function () {
      const { options, calls } = fixture();
      const result = await runZkSetup({ ...options, circuit });
      assert.deepEqual(
        calls.map(([name]) => name),
        expected,
      );
      const selectedSetup = calls.find(([name]) => name.startsWith("setup"));
      if (selectedSetup) assert.deepEqual(selectedSetup[1].circuits, [circuit.split(":")[1]]);
      if (circuit === "person") assert.equal(calls[0][1].circuit, "person");
      assert.deepEqual(result.regeneratedCircuits, circuit.includes(":") ? [circuit] : []);
    });

  for (const operation of [
    "buildCore",
    "inspectIdentity",
    "setupProtocol",
    "setupBoundary",
    "check",
  ])
    it(`stops immediately after a failed ${operation} without reporting readiness`, async function () {
      const { options, calls, failure } = fixture(operation);
      const messages = [];
      await assert.rejects(
        main([], { ...options, log: (message) => messages.push(message) }),
        (error) => error === failure,
      );
      assert.equal(calls.at(-1)[0], operation);
      assert.deepEqual(messages, []);
      if (["buildCore", "inspectIdentity"].includes(operation))
        assert.equal(
          calls.some(([name]) => name.startsWith("setup")),
          false,
        );
    });

  it("shows help without invoking compilation, checks or key setup", async function () {
    const { options, calls } = fixture();
    const messages = [];
    await main(["--help"], { ...options, log: (message) => messages.push(message) });
    assert.deepEqual(calls, []);
    assert.match(messages[0], /all 13/u);
    assert.match(messages[0], /ceremony/u);
  });

  it("rejects retired selectors before touching any artifacts", async function () {
    const { options, calls } = fixture();
    await assert.rejects(runZkSetup({ ...options, circuit: "shielded:fund" }), /expected one of/u);
    assert.deepEqual(calls, []);
  });

  it("honors npm-forwarded selectors instead of silently rotating the default graph", async function () {
    const { options, calls } = fixture();
    const result = await main(["--circuit", "protocol:code", "--ptau", "specific.ptau"], {
      ...options,
      log: () => {},
    });
    assert.deepEqual(result.regeneratedCircuits, ["protocol:code"]);
    assert.deepEqual(calls.find(([name]) => name === "setupProtocol")[1], {
      root,
      circuits: ["code"],
      ptauPath: "specific.ptau",
    });
    assert.equal(
      calls.some(([name]) => name === "setupBoundary"),
      false,
    );
  });
});
