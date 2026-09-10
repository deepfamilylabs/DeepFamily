# DeepFamily Archive V1

`DeepFamilyArchiveV1` is an immutable archive bound to one DeepFamily proxy. The proxy has one owner-only, proxy-only `setArchive(address)` call. It checks deployed code, ERC-165, the reverse `DEEP_FAMILY()` binding, `archiveKind() == keccak256("deepfamily.archive.v1")`, and `apiVersion() == 1`. Every Archive write checks that `DeepFamily.archive()` still selects it. Release tooling independently checks the complete deployed runtime with immutable addresses substituted.

## Records and authorization

```solidity
struct BlobRef {
  bytes32 payloadHash;
  address pointer;
  uint64 payloadLength;
  uint32 segmentCount;
}
struct StoryRecordRef {
  BlobRef blob;
  bytes32 schemaId;
  address author;
  uint64 timestamp;
}
struct StoryState {
  bytes32 recordsHead;
  uint64 totalRecords;
  uint64 totalPayloadLength;
  uint64 lastUpdateTime;
  bool isSealed;
}
```

`storeMetadata(personHash, versionIndex, envelope)` is callable only by DeepFamily and writes each key once. `metadataRef` returns its BlobRef. The archive does not parse metadata formats. DeepFamily checks the permanent 20-byte DFM1 prefix; the client enforces the 16,384-byte format-1 envelope maximum. The common prefix and the Blob layer have no format-1 size cap, so a future larger format can use the same Archive.

`initializeStory(tokenId, author, payload, expectedPayloadHash)` is callable only by DeepFamily, once per token, before `_safeMint` invokes an ERC721 receiver. An empty payload still consumes initialization, with `keccak256(0x)` required, but creates no record. A nonempty payload is the first record, under the reserved `deepfamily/story-biography-envelope@1.0` schema, attributed to the actual minter. Initialization, every segment, and NFT minting succeed or revert together. The initial biography participates in counts, total stored length, hash heads, and sealing. `PersonSupplementInfo` no longer contains a short `story` field. Mint calldata supplies a separate compressed story envelope and its expected hash.

`appendStoryRecord(tokenId, expectedIndex, expectedHead, schemaId, payload, expectedPayloadHash)` requires the current NFT owner. Ordinary appends reject the reserved biography schema. Indexes start at zero. Both index and head must match current state, schema must be nonzero, and the supplied hash must equal `keccak256(payload)`; zero is not a bypass. Payloads are nonempty. `sealStory(tokenId, expectedCount, expectedHead)` requires the same ownership and concurrency checks, rejects an empty or already sealed story, and prevents further appends permanently. NFT transfer changes who may append or seal; prior authors remain recorded.

## Semantic commitment

The initial head is `bytes32(0)`. Domain constants are the keccak256 hashes of the literal UTF-8 strings `deepfamily.archive.story-record.v1` and `deepfamily.archive.story-head.v1`.

```text
recordHash = keccak256(abi.encode(
  bytes32(STORY_RECORD_DOMAIN), uint256(chainId), address(archive),
  uint256(tokenId), uint64(index), bytes32(schemaId), bytes32(payloadHash),
  uint64(payloadLength), address(author), uint64(timestamp)
))
newHead = keccak256(abi.encode(
  bytes32(STORY_HEAD_DOMAIN), bytes32(previousHead), bytes32(recordHash)
))
```

Pointers, segment count and manifest layout are physical storage details and do not affect the semantic commitment. `MetadataStored` includes the full BlobRef. `StoryRecordAppended` includes token/index, full BlobRef, schema, author, timestamp, recordHash and newHead. `StorySealed` records final count/head/logical byte total, sealer and timestamp. Shared Solidity/JavaScript vectors are in [archive-story-v1.json](../protocol-vectors/archive-story-v1.json).

## Atomic bytecode storage

Each segment is `0x00 || payload slice`, with at most 16,384 payload bytes. A one-segment BlobRef points directly to that segment. Larger payloads point to the first DFBP manifest page. All segments, pages, refs and state updates are created in one transaction; any failure reverts them together. No upload session or partial Blob is exposed.

Every manifest page uses this exact runtime layout. Integers are unsigned big-endian; addresses are packed 20 bytes.

| Offset |           Width | Field                            |
| -----: | --------------: | -------------------------------- |
|      0 |               1 | STOP (`0x00`)                    |
|      1 |               4 | ASCII `DFBP`                     |
|      5 |               1 | Version 1                        |
|      6 |               4 | pageIndex                        |
|     10 |               4 | pageCount                        |
|     14 |               4 | firstSegmentIndex                |
|     18 |               4 | entryCount                       |
|     22 |              20 | nextPage, zero on the final page |
|     42 |               8 | Complete payloadLength           |
|     50 |               4 | segmentCount                     |
|     54 |              32 | Complete payloadHash             |
|     86 | 20 × entryCount | Segment addresses                |

Pages contain up to 1,024 entries, giving at most 20,566 runtime bytes. Pages are deployed in reverse order to resolve their next pointers. The reader checks exact lengths, magic/version, page ordering, count/length/hash consistency, links and nonzero unique addresses. All segments except the last must contain exactly 16,384 payload bytes. Byte concatenation and complete length/hash verification precede UTF-8 or JSON decoding. UTF-8 characters and JSON escapes may cross segment boundaries.

There is no Archive business maximum on total bytes. Representation uses uint64 length and uint32 count with checked conversions; actual capacity is limited by transaction resources. Sixteen KiB segments and manifest pages fit the Ethereum [runtime](https://eips.ethereum.org/EIPS/eip-170) and [initcode](https://eips.ethereum.org/EIPS/eip-3860) limits. [eSpace](https://doc.confluxnetwork.org/docs/espace/build/evm-compatibility/) uses different gas costs. Raising block capacity alone does not necessarily raise an independent transaction cap.

## Public story envelope and canonical text

Public records use `schemaId = keccak256(UTF8("deepfamily/story-envelope@1.0"))`. The reserved mint biography uses `keccak256(UTF8("deepfamily/story-biography-envelope@1.0"))`. Both contain a DFSE envelope with this fixed, big-endian header:

| Offset | Bytes | Field |
| ---: | ---: | --- |
| 0 | 4 | `DFSE` magic |
| 4 | 1 | Format version = 1 |
| 5 | 1 | Plaintext codec = 1, canonical story JSON |
| 6 | 1 | Compression suite = 1, gzip-v1 |
| 7 | 1 | Flags = 0 |
| 8 | 8 | Complete uncompressed record length |
| 16 | 32 | keccak256 of complete uncompressed canonical record |
| 48 | remaining | gzip-compressed record |

The frontend application policy fixes gzip-v1 (level 6, mtime 0, one member, no trailing bytes). There is no user compression option and no size-dependent fallback, including for short records. Compression precedes physical segmentation. Private metadata retains its own unchanged DFM1 compression/encryption format. Public story decompression has an explicit **16 MiB per-record output bound**, separate from private metadata's 1 MiB bound; a story may contain multiple records. Declared length is checked before allocation, the gzip stream must be complete, and actual length and original hash must match. Stored `payloadHash` and length refer to the complete compressed envelope. Public compression does not encrypt or restrict reading.

The inner JSON schema is `deepfamily/story-chunk@1.0`. The exact key order is:

<!-- prettier-ignore -->
```json
{"schema":"deepfamily/story-chunk@1.0","content":"Exact text","chunkType":3,"attachmentCID":""}
```

There is no BOM, extra whitespace or trailing newline. Strings contain Unicode scalar values. Quotes and backslashes are escaped; backspace, tab, newline, form feed and carriage return use short JSON escapes. Other C0 controls use lowercase `\u00xx`. Other characters, including slash, emoji and U+2028/U+2029, are emitted literally. `chunkType` is an unsigned decimal integer from 0 to 255. Zero denotes the mint biography and is valid only under its reserved schema. The 19 existing editable types move to 1–19 (Summary=1, Early Life=2, ..., Notes=19); the normal editor omits zero. Record index and type are independent: an NFT with no initial biography can start with index 0 and type 1. For all types, negative zero is rejected. Unknown, missing or duplicate keys, invalid UTF-8 and unpaired surrogates are rejected. Decoding re-encodes the complete record and compares bytes.

`content` is preserved without trimming or normalization. Empty/whitespace-only content is rejected using a frozen ECMAScript trim set: U+0009–000D, U+0020, U+00A0, U+1680, U+2000–200A, U+2028–2029, U+202F, U+205F, U+3000 and U+FEFF. `attachmentCID` may be empty; otherwise it has no edge characters from that set and is at most 256 UTF-8 bytes.

The Archive never decompresses or interprets DFSE/DFS1. It enforces the reserved initialization source through the outer schema. `readStoryRecord` verifies storage first and returns `decoded: null` with raw bytes for an unknown schema. Future attachment, language or signing formats must use a new schema. Future compression algorithms get new suite IDs; envelope structure changes get a new format/schema. Existing IDs must never be redefined. Unknown schema, envelope version, codec or compression is returned as verified raw bytes with an unsupported reason, without guessing a decoder. Keep published format specifications, decoder rules, and golden vectors so earlier records remain readable. The current application writes only gzip-v1.

## Reader, transactions and release

`DeepFamilyReader` binds `DEEP_FAMILY` and `ARCHIVE` immutably and exposes `getVersionMetadataRef`, `getStoryRecordRef`, `getStoryState` and `listStoryRecords` (at most 100 refs). It does not return large Story byte arrays or parse codec fields. `protocol-core.readArchiveBlob` fetches code with default concurrency eight and verifies the complete Blob.

Clients freeze canonical payload bytes before estimating and send the identical arguments. They require successful full-call estimation, use integer ceiling `(estimate * 120 + 99) / 100`, and stop before signing if the result exceeds the chain transaction cap or current RPC block gas limit. Ethereum profiles include the [EIP-7825 transaction cap](https://eips.ethereum.org/EIPS/eip-7825). eSpace RPC block gas limit already represents its gas allowance; clients also enforce its calldata gas floor. A failed estimate has no fixed gas fallback. Previews include canonical bytes, hash/length, segment count, estimate, buffered gas and fees. Receipts and final refs are reconciled after submission.

A payload that cannot fit may be manually divided into multiple logical Story records. Metadata remains an atomic version write. Development releases use a `not-deployed` manifest; production release tooling freezes current ABI, address predictions, storage baseline, artifacts and immutable-linked runtimes. There is no old Archive API or deployment-state compatibility layer.

## Mint import and reading

The mint form accepts a full public biography or an explicit copy from the validated, unlocked metadata of the exact target version. It preserves original text and retains the disclosure confirmation; it does not change the encrypted private original. The complete mint-plus-biography call is estimated with the same buffer/cap rules, previewed, and sent with frozen arguments. Receipt, reserved reference, author, stored bytes and hash head are reconciled afterward. If the transaction cannot fit, the user must adjust the public text before minting. There is no separate post-mint upload that could leave an incomplete biography.

NFT detail readers hydrate the initial reserved record from Archive as `nftPublicStory`, displayed in the basic story area. It is excluded from detailed story lists, their full text, visible chunk counts and byte totals. Ordinary story display numbers begin at 1, whether or not a biography was supplied during minting. A biography alone therefore means zero detailed story chunks. Archive record indices, pagination, commitments, append checks and sealing still cover all records, including the biography. Readers retain the raw Archive metadata separately from these derived display totals. Editing or transferring the NFT never grants access to the private passphrase, changes the private version, or permits replacing the initial public biography.
