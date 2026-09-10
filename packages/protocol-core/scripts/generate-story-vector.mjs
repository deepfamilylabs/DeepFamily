import fs from "node:fs";
import { hexlify, keccak256 } from "ethers";
import {
  STORY_CHUNK_SCHEMA,
  STORY_CHUNK_SCHEMA_ID,
  STORY_RECORD_DOMAIN,
  STORY_RECORD_DOMAIN_TEXT,
  STORY_HEAD_DOMAIN,
  STORY_HEAD_DOMAIN_TEXT,
  ZERO_BYTES32,
  computeStoryRecordHash,
  computeStoryHead,
  encodeStoryRecord,
  encodeCanonicalStoryRecord,
  STORY_ENVELOPE_SCHEMA,
} from "../index.js";

const contents = [
  {
    content: '  中😀 e\u0301\n"quote" \\ /\t\u0000\u001f\u2028\u2029  ',
    chunkType: 3,
    attachmentCID: "ipfs://例子/😀",
  },
  { content: "Second record\r\nkeeps its final newline.\n", chunkType: 255, attachmentCID: "" },
];
let previousHead = ZERO_BYTES32;
const records = contents.map((input, index) => {
  const payload = encodeStoryRecord(input);
  const commitment = {
    chainId: "31337",
    archive: "0x1111111111111111111111111111111111111111",
    tokenId: "7",
    index: String(index),
    schemaId: STORY_CHUNK_SCHEMA_ID,
    payloadHash: keccak256(payload),
    payloadLength: String(payload.length),
    author:
      index === 0
        ? "0x2222222222222222222222222222222222222222"
        : "0x3333333333333333333333333333333333333333",
    timestamp: String(1_700_000_000 + index),
  };
  const recordHash = computeStoryRecordHash(commitment);
  const newHead = computeStoryHead({ previousHead, recordHash });
  const record = {
    input,
    canonicalJson: new TextDecoder().decode(encodeCanonicalStoryRecord(input)),
    canonicalHex: hexlify(payload),
    commitment,
    previousHead,
    recordHash,
    newHead,
  };
  previousHead = newHead;
  return record;
});
const vector = {
  schema: STORY_ENVELOPE_SCHEMA,
  plaintextSchema: STORY_CHUNK_SCHEMA,
  schemaId: STORY_CHUNK_SCHEMA_ID,
  recordDomainText: STORY_RECORD_DOMAIN_TEXT,
  recordDomain: STORY_RECORD_DOMAIN,
  headDomainText: STORY_HEAD_DOMAIN_TEXT,
  headDomain: STORY_HEAD_DOMAIN,
  initialHead: ZERO_BYTES32,
  recordAbiTypes: [
    "bytes32",
    "uint256",
    "address",
    "uint256",
    "uint64",
    "bytes32",
    "bytes32",
    "uint64",
    "address",
    "uint64",
  ],
  headAbiTypes: ["bytes32", "bytes32", "bytes32"],
  records,
  finalHead: previousHead,
};
fs.writeFileSync(
  new URL("../../../protocol-vectors/archive-story-v1.json", import.meta.url),
  `${JSON.stringify(vector, null, 2)}\n`,
);
