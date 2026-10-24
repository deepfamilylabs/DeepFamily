import { Interface, ZeroAddress, getAddress, id, toQuantity } from "ethers";
import { createShieldedIdentityAuthorizationTree } from "@deepfamily/protocol-core";

const HEAD = 12;
const CREATION = 1;
const address = (suffix) => getAddress(`0x${suffix.toString(16).padStart(40, "0")}`);
const AUTHORIZATION_ABI = [
  "function creationBlock() view returns (uint256)",
  "function currentCheckpointId() view returns (uint256)",
  "function currentRoot() view returns (uint256)",
  "function getCheckpoint(uint256) view returns (tuple(uint256 root,uint64 createdAt,uint64 retiredAt))",
  "function getCounterProof(uint256) view returns (tuple(uint64 authorizationCounter,uint256 stateRoot,uint256 depth,uint256[64] siblings,uint256 oldKey,uint64 oldValue,bool isOld0,bool absent))",
  "function getStateSnapshotHeader() view returns (tuple(uint256 formatVersion,uint64 rootNodeId,uint64 nodeCount,uint256 root,uint256 checkpointId))",
  "function getNodePage(uint256,uint256) view returns (tuple(uint256 hash,uint256 key,uint64 counter,uint64 left,uint64 right)[])",
  "event CounterIncremented(uint256 indexed checkpointId,uint256 indexed aliasR,uint64 oldCounter,uint64 newCounter,uint256 oldRoot,uint256 newRoot,uint256 authorizationNullifier)",
];

/**
 * A read-only, empty protocol state for the CSP browser scan. Requests are served
 * by Playwright on the site's own origin; no chain process or real RPC is used.
 */
export function createCspScanRpcFixture({ timestamp = 1_800_000_000 } = {}) {
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp <= HEAD ||
    timestamp + 86_400 > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("Invalid CSP fixture timestamp");
  }
  const context = Object.freeze({
    chainId: "31337",
    factoryAddress: address(0xc501),
    factoryDeploymentBlock: CREATION,
    familyAddress: address(0xc502),
    lineageIndexAddress: address(0xc503),
    poolAddress: address(0xc504),
    poolDeploymentBlock: CREATION,
    lettersAddress: address(0xc505),
    assetKind: "native",
    stateReadMode: "rebuild",
  });
  const authorizationStateAddress = address(0xc506);
  const verifierAddress = address(0xc507);
  const authorization = new Interface(AUTHORIZATION_ABI);
  const emptyTree = createShieldedIdentityAuthorizationTree();
  const calls = [];
  const errors = [];
  const fail = (message, code = -32602) => {
    throw Object.assign(new Error(message), { code });
  };
  const assert = (condition, message) => {
    if (!condition) fail(message);
  };
  const interfaces = new Map([
    [
      context.factoryAddress.toLowerCase(),
      new Interface([
        "function AUTHORIZATION_STATE() view returns (address)",
        "function LINEAGE_INDEX() view returns (address)",
        "function VERIFIER() view returns (address)",
        "function poolFor(address) view returns (address)",
      ]),
    ],
    [
      context.familyAddress.toLowerCase(),
      new Interface(["function lineageIndex() view returns (address)"]),
    ],
    [
      context.poolAddress.toLowerCase(),
      new Interface([
        "function protocolVersion() view returns (uint256)",
        "function LINEAGE_INDEX() view returns (address)",
        "function VERIFIER() view returns (address)",
        "function assetKind() view returns (uint256)",
        "function AUTHORIZATION_STATE() view returns (address)",
      ]),
    ],
    [
      context.lettersAddress.toLowerCase(),
      new Interface([
        "function POOL_FACTORY() view returns (address)",
        "function AUTHORIZATION_STATE() view returns (address)",
      ]),
    ],
    [authorizationStateAddress.toLowerCase(), authorization],
  ]);
  const blockNumber = (tag) => {
    if (tag === "latest") return HEAD;
    assert(
      typeof tag === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(tag),
      "Unsupported fixture block tag",
    );
    const value = Number(BigInt(tag));
    assert(
      Number.isSafeInteger(value) && value >= CREATION && value <= HEAD,
      "Fixture block is unavailable",
    );
    return value;
  };
  const block = (number) => ({
    number: toQuantity(number),
    hash: id(`DeepFamily CSP fixture block ${number}`),
    parentHash: id(`DeepFamily CSP fixture block ${number - 1}`),
    timestamp: toQuantity(timestamp - (HEAD - number)),
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    miner: ZeroAddress,
    extraData: "0x",
    baseFeePerGas: "0x1",
    transactions: [],
  });
  const call = (transaction, tag) => {
    assert(transaction && typeof transaction === "object", "Missing fixture call transaction");
    let to;
    try {
      to = getAddress(transaction.to).toLowerCase();
    } catch {
      fail("Invalid fixture call address");
    }
    const iface = interfaces.get(to);
    assert(iface, "Unknown fixture contract");
    const atBlock = blockNumber(tag);
    let parsed;
    try {
      parsed = iface.parseTransaction({ data: transaction.data });
    } catch {
      fail("Invalid fixture call data");
    }
    assert(parsed, "Unknown fixture contract selector");
    assert(
      iface.encodeFunctionData(parsed.fragment, parsed.args).toLowerCase() ===
        transaction.data.toLowerCase(),
      "Noncanonical fixture call data",
    );
    const { name, args } = parsed;
    const createdAt = BigInt(timestamp - (HEAD - CREATION));
    let values;
    switch (name) {
      case "AUTHORIZATION_STATE":
        values = [authorizationStateAddress];
        break;
      case "LINEAGE_INDEX":
      case "lineageIndex":
        values = [context.lineageIndexAddress];
        break;
      case "VERIFIER":
        values = [verifierAddress];
        break;
      case "POOL_FACTORY":
        values = [context.factoryAddress];
        break;
      case "poolFor":
        assert(args[0] === ZeroAddress, "Only the native fixture pool exists");
        values = [context.poolAddress];
        break;
      case "protocolVersion":
      case "assetKind":
      case "currentCheckpointId":
        values = [1n];
        break;
      case "creationBlock":
        values = [BigInt(CREATION)];
        break;
      case "currentRoot":
        values = [emptyTree.root];
        break;
      case "getCheckpoint":
        assert(args[0] === 1n, "Unknown fixture authorization checkpoint");
        values = [[emptyTree.root, createdAt, 0n]];
        break;
      case "getStateSnapshotHeader":
        values = [[1n, 0n, 0n, emptyTree.root, 1n]];
        break;
      case "getNodePage":
        assert(args[0] === 1n && args[1] > 0n && args[1] <= 256n, "Invalid fixture node page");
        values = [[]];
        break;
      case "getCounterProof": {
        const witness = emptyTree.getWitness(args[0]);
        values = [
          [
            witness.authorizationCounter,
            witness.stateRoot,
            witness.depth,
            witness.siblings,
            witness.oldKey,
            witness.oldValue,
            witness.isOld0 === 1n,
            witness.absent === 1n,
          ],
        ];
        break;
      }
      default:
        fail("Unsupported fixture contract function");
    }
    calls.push({ method: "eth_call", to, selector: parsed.selector, blockNumber: atBlock });
    return iface.encodeFunctionResult(parsed.fragment, values);
  };
  const respond = (request) => {
    const responseId = request?.id ?? null;
    try {
      assert(
        request &&
          typeof request === "object" &&
          !Array.isArray(request) &&
          request.jsonrpc === "2.0" &&
          (typeof request.id === "string" || Number.isSafeInteger(request.id)),
        "Invalid fixture JSON-RPC request",
      );
      const { method, params = [] } = request;
      assert(Array.isArray(params), "Fixture RPC params must be positional");
      let result;
      switch (method) {
        case "eth_chainId":
          assert(params.length === 0, "Unexpected chain ID parameters");
          result = toQuantity(context.chainId);
          break;
        case "eth_blockNumber":
          assert(params.length === 0, "Unexpected block number parameters");
          result = toQuantity(HEAD);
          break;
        case "eth_getBlockByNumber":
          assert(
            params.length === 2 && params[1] === false,
            "Only fixture block headers are available",
          );
          result = block(blockNumber(params[0]));
          break;
        case "eth_call":
          assert(params.length === 2, "Fixture eth_call requires an explicit block tag");
          result = call(params[0], params[1]);
          break;
        case "eth_getLogs": {
          assert(params.length === 1, "Invalid fixture log filter");
          const filter = params[0];
          assert(
            filter && typeof filter === "object" && !Array.isArray(filter),
            "Invalid fixture log filter",
          );
          assert(
            typeof filter.address === "string" &&
              filter.address.toLowerCase() === authorizationStateAddress.toLowerCase(),
            "Unknown fixture event contract",
          );
          assert(
            Array.isArray(filter.topics) &&
              filter.topics.length === 1 &&
              filter.topics[0] === authorization.getEvent("CounterIncremented").topicHash,
            "Unknown fixture event topic",
          );
          assert(
            blockNumber(filter.fromBlock) <= blockNumber(filter.toBlock),
            "Invalid fixture event range",
          );
          result = [];
          break;
        }
        default:
          fail("Unsupported CSP fixture RPC method", -32601);
      }
      if (method !== "eth_call") calls.push({ method });
      return { jsonrpc: "2.0", id: responseId, result };
    } catch (error) {
      const message =
        error?.message?.startsWith("Invalid") || error?.message?.includes("fixture")
          ? error.message
          : "Invalid CSP fixture request";
      errors.push({
        method: typeof request?.method === "string" ? request.method : "invalid",
        message,
      });
      return {
        jsonrpc: "2.0",
        id: responseId,
        error: { code: Number.isInteger(error?.code) ? error.code : -32602, message },
      };
    }
  };
  return {
    context,
    authorizationStateAddress,
    checkpointId: "1",
    stateRoot: String(emptyTree.root),
    asOf: String(timestamp),
    expiresAt: String(timestamp + 86_400),
    calls,
    errors,
    handle(payload) {
      if (Array.isArray(payload)) {
        if (payload.length === 0) return respond(null);
        return payload.map(respond);
      }
      return respond(payload);
    },
  };
}
