// Release-frozen Archive V1 wire interface. Changes require an explicit protocol revision.
const definition = {
  schemaVersion: 1,
  types: {
    BlobRef: [
      {
        name: "payloadHash",
        type: "bytes32",
      },
      {
        name: "pointer",
        type: "address",
      },
      {
        name: "payloadLength",
        type: "uint64",
      },
      {
        name: "segmentCount",
        type: "uint32",
      },
    ],
    StoryRecordRef: [
      {
        name: "blob",
        type: "tuple",
        components: [
          {
            name: "payloadHash",
            type: "bytes32",
          },
          {
            name: "pointer",
            type: "address",
          },
          {
            name: "payloadLength",
            type: "uint64",
          },
          {
            name: "segmentCount",
            type: "uint32",
          },
        ],
      },
      {
        name: "schemaId",
        type: "bytes32",
      },
      {
        name: "author",
        type: "address",
      },
      {
        name: "timestamp",
        type: "uint64",
      },
    ],
    StoryState: [
      {
        name: "recordsHead",
        type: "bytes32",
      },
      {
        name: "totalRecords",
        type: "uint64",
      },
      {
        name: "totalPayloadLength",
        type: "uint64",
      },
      {
        name: "lastUpdateTime",
        type: "uint64",
      },
      {
        name: "isSealed",
        type: "bool",
      },
    ],
  },
  deepFamilyArchiveV1: {
    abiPolicy: {
      nonErrorFragments: "exact-set",
      errorFragments: "excluded",
    },
    abi: [
      {
        type: "constructor",
        stateMutability: "nonpayable",
        inputs: [
          {
            name: "deepFamily",
            type: "address",
          },
        ],
      },
      {
        type: "event",
        name: "MetadataStored",
        topic0: "0x74f16ce0ab387b28ad33a7a3e2ea7f6096d64e0c04df1626c7df48eaebf80e4e",
        anonymous: false,
        inputs: [
          {
            name: "personHash",
            type: "bytes32",
            indexed: true,
          },
          {
            name: "versionIndex",
            type: "uint256",
            indexed: true,
          },
          {
            name: "blob",
            type: "tuple",
            components: [
              {
                name: "payloadHash",
                type: "bytes32",
              },
              {
                name: "pointer",
                type: "address",
              },
              {
                name: "payloadLength",
                type: "uint64",
              },
              {
                name: "segmentCount",
                type: "uint32",
              },
            ],
            indexed: false,
          },
        ],
      },
      {
        type: "event",
        name: "StoryRecordAppended",
        topic0: "0x18ce26f57931e43b580c3032b2b6f8c7e95b0cbc762434e0d26266871bc1017a",
        anonymous: false,
        inputs: [
          {
            name: "tokenId",
            type: "uint256",
            indexed: true,
          },
          {
            name: "index",
            type: "uint64",
            indexed: true,
          },
          {
            name: "blob",
            type: "tuple",
            components: [
              {
                name: "payloadHash",
                type: "bytes32",
              },
              {
                name: "pointer",
                type: "address",
              },
              {
                name: "payloadLength",
                type: "uint64",
              },
              {
                name: "segmentCount",
                type: "uint32",
              },
            ],
            indexed: false,
          },
          {
            name: "schemaId",
            type: "bytes32",
            indexed: false,
          },
          {
            name: "author",
            type: "address",
            indexed: true,
          },
          {
            name: "timestamp",
            type: "uint64",
            indexed: false,
          },
          {
            name: "recordHash",
            type: "bytes32",
            indexed: false,
          },
          {
            name: "newHead",
            type: "bytes32",
            indexed: false,
          },
        ],
      },
      {
        type: "event",
        name: "StorySealed",
        topic0: "0xdf46e133f32bf9de04098a7594fc8a05a5d54c89d63b3b9a23a5b68680555722",
        anonymous: false,
        inputs: [
          {
            name: "tokenId",
            type: "uint256",
            indexed: true,
          },
          {
            name: "totalRecords",
            type: "uint64",
            indexed: false,
          },
          {
            name: "recordsHead",
            type: "bytes32",
            indexed: false,
          },
          {
            name: "totalPayloadLength",
            type: "uint64",
            indexed: false,
          },
          {
            name: "sealer",
            type: "address",
            indexed: true,
          },
          {
            name: "timestamp",
            type: "uint64",
            indexed: false,
          },
        ],
      },
      {
        type: "function",
        name: "BIOGRAPHY_SCHEMA_ID",
        selector: "0x106556ce",
        stateMutability: "view",
        inputs: [],
        outputs: [
          {
            name: "",
            type: "bytes32",
          },
        ],
      },
      {
        type: "function",
        name: "DEEP_FAMILY",
        selector: "0x4130d94c",
        stateMutability: "view",
        inputs: [],
        outputs: [
          {
            name: "",
            type: "address",
          },
        ],
      },
      {
        type: "function",
        name: "MAX_MANIFEST_ENTRIES",
        selector: "0xfebebb72",
        stateMutability: "view",
        inputs: [],
        outputs: [
          {
            name: "",
            type: "uint256",
          },
        ],
      },
      {
        type: "function",
        name: "MAX_SEGMENT_PAYLOAD_LENGTH",
        selector: "0x0c645eb2",
        stateMutability: "view",
        inputs: [],
        outputs: [
          {
            name: "",
            type: "uint256",
          },
        ],
      },
      {
        type: "function",
        name: "STORY_HEAD_DOMAIN",
        selector: "0x583eb74d",
        stateMutability: "view",
        inputs: [],
        outputs: [
          {
            name: "",
            type: "bytes32",
          },
        ],
      },
      {
        type: "function",
        name: "STORY_RECORD_DOMAIN",
        selector: "0xcffea532",
        stateMutability: "view",
        inputs: [],
        outputs: [
          {
            name: "",
            type: "bytes32",
          },
        ],
      },
      {
        type: "function",
        name: "apiVersion",
        selector: "0x25829410",
        stateMutability: "pure",
        inputs: [],
        outputs: [
          {
            name: "",
            type: "uint256",
          },
        ],
      },
      {
        type: "function",
        name: "appendStoryRecord",
        selector: "0xd6180410",
        stateMutability: "nonpayable",
        inputs: [
          {
            name: "tokenId",
            type: "uint256",
          },
          {
            name: "expectedIndex",
            type: "uint64",
          },
          {
            name: "expectedHead",
            type: "bytes32",
          },
          {
            name: "schemaId",
            type: "bytes32",
          },
          {
            name: "payload",
            type: "bytes",
          },
          {
            name: "expectedPayloadHash",
            type: "bytes32",
          },
        ],
        outputs: [
          {
            name: "record",
            type: "tuple",
            components: [
              {
                name: "blob",
                type: "tuple",
                components: [
                  {
                    name: "payloadHash",
                    type: "bytes32",
                  },
                  {
                    name: "pointer",
                    type: "address",
                  },
                  {
                    name: "payloadLength",
                    type: "uint64",
                  },
                  {
                    name: "segmentCount",
                    type: "uint32",
                  },
                ],
              },
              {
                name: "schemaId",
                type: "bytes32",
              },
              {
                name: "author",
                type: "address",
              },
              {
                name: "timestamp",
                type: "uint64",
              },
            ],
          },
        ],
      },
      {
        type: "function",
        name: "archiveKind",
        selector: "0xe31c3b81",
        stateMutability: "pure",
        inputs: [],
        outputs: [
          {
            name: "",
            type: "bytes32",
          },
        ],
      },
      {
        type: "function",
        name: "initializeStory",
        selector: "0x9396cfc5",
        stateMutability: "nonpayable",
        inputs: [
          {
            name: "tokenId",
            type: "uint256",
          },
          {
            name: "author",
            type: "address",
          },
          {
            name: "payload",
            type: "bytes",
          },
          {
            name: "expectedPayloadHash",
            type: "bytes32",
          },
        ],
        outputs: [],
      },
      {
        type: "function",
        name: "metadataRef",
        selector: "0xa9014530",
        stateMutability: "view",
        inputs: [
          {
            name: "personHash",
            type: "bytes32",
          },
          {
            name: "versionIndex",
            type: "uint256",
          },
        ],
        outputs: [
          {
            name: "blob",
            type: "tuple",
            components: [
              {
                name: "payloadHash",
                type: "bytes32",
              },
              {
                name: "pointer",
                type: "address",
              },
              {
                name: "payloadLength",
                type: "uint64",
              },
              {
                name: "segmentCount",
                type: "uint32",
              },
            ],
          },
        ],
      },
      {
        type: "function",
        name: "sealStory",
        selector: "0xa65f15a6",
        stateMutability: "nonpayable",
        inputs: [
          {
            name: "tokenId",
            type: "uint256",
          },
          {
            name: "expectedCount",
            type: "uint64",
          },
          {
            name: "expectedHead",
            type: "bytes32",
          },
        ],
        outputs: [
          {
            name: "state",
            type: "tuple",
            components: [
              {
                name: "recordsHead",
                type: "bytes32",
              },
              {
                name: "totalRecords",
                type: "uint64",
              },
              {
                name: "totalPayloadLength",
                type: "uint64",
              },
              {
                name: "lastUpdateTime",
                type: "uint64",
              },
              {
                name: "isSealed",
                type: "bool",
              },
            ],
          },
        ],
      },
      {
        type: "function",
        name: "storeMetadata",
        selector: "0xed9db949",
        stateMutability: "nonpayable",
        inputs: [
          {
            name: "personHash",
            type: "bytes32",
          },
          {
            name: "versionIndex",
            type: "uint256",
          },
          {
            name: "envelope",
            type: "bytes",
          },
        ],
        outputs: [
          {
            name: "blob",
            type: "tuple",
            components: [
              {
                name: "payloadHash",
                type: "bytes32",
              },
              {
                name: "pointer",
                type: "address",
              },
              {
                name: "payloadLength",
                type: "uint64",
              },
              {
                name: "segmentCount",
                type: "uint32",
              },
            ],
          },
        ],
      },
      {
        type: "function",
        name: "storyRecordRef",
        selector: "0x29860c08",
        stateMutability: "view",
        inputs: [
          {
            name: "tokenId",
            type: "uint256",
          },
          {
            name: "index",
            type: "uint64",
          },
        ],
        outputs: [
          {
            name: "record",
            type: "tuple",
            components: [
              {
                name: "blob",
                type: "tuple",
                components: [
                  {
                    name: "payloadHash",
                    type: "bytes32",
                  },
                  {
                    name: "pointer",
                    type: "address",
                  },
                  {
                    name: "payloadLength",
                    type: "uint64",
                  },
                  {
                    name: "segmentCount",
                    type: "uint32",
                  },
                ],
              },
              {
                name: "schemaId",
                type: "bytes32",
              },
              {
                name: "author",
                type: "address",
              },
              {
                name: "timestamp",
                type: "uint64",
              },
            ],
          },
        ],
      },
      {
        type: "function",
        name: "storyState",
        selector: "0xa16189df",
        stateMutability: "view",
        inputs: [
          {
            name: "tokenId",
            type: "uint256",
          },
        ],
        outputs: [
          {
            name: "state",
            type: "tuple",
            components: [
              {
                name: "recordsHead",
                type: "bytes32",
              },
              {
                name: "totalRecords",
                type: "uint64",
              },
              {
                name: "totalPayloadLength",
                type: "uint64",
              },
              {
                name: "lastUpdateTime",
                type: "uint64",
              },
              {
                name: "isSealed",
                type: "bool",
              },
            ],
          },
        ],
      },
      {
        type: "function",
        name: "supportsInterface",
        selector: "0x01ffc9a7",
        stateMutability: "view",
        inputs: [
          {
            name: "interfaceId",
            type: "bytes4",
          },
        ],
        outputs: [
          {
            name: "",
            type: "bool",
          },
        ],
      },
    ],
    semantics: {
      immutableBindings: {
        DEEP_FAMILY: "constructor.deepFamily",
      },
      constants: {
        MAX_SEGMENT_PAYLOAD_LENGTH: {
          type: "uint256",
          value: 16384,
        },
        MAX_MANIFEST_ENTRIES: {
          type: "uint256",
          value: 1024,
        },
        STORY_RECORD_DOMAIN: {
          type: "bytes32",
          value: "0x11c45f73aceb35bc7e9827edf3c5d495de8edc96001c2cd2bb7940c161f15a98",
        },
        STORY_HEAD_DOMAIN: {
          type: "bytes32",
          value: "0x53b5e51d2cea7f54d1dc5c2bb4e490b0cfe0dd605c62c0fd8445117109736ca8",
        },
        BIOGRAPHY_SCHEMA_ID: {
          type: "bytes32",
          value: "0x22253a7cc8948414ca943f8c643c363f1c46ea9d5d77ee6949bd5ff0f6b5ae86",
        },
      },
      activeBinding: "DEEP_FAMILY.archive() == address(this)",
      metadata: {
        authorization: "msg.sender == DEEP_FAMILY",
        key: ["personHash", "versionIndex"],
        writeOnce: true,
      },
      story: {
        authorization: "msg.sender == DEEP_FAMILY.ownerOf(tokenId)",
        schema: "nonzero opaque bytes; reserved biography schema rejected by ordinary append",
        expectedPayloadHash: "mandatory keccak256(payload)",
        concurrency: ["expectedIndex == totalRecords", "expectedHead == recordsHead"],
        initialHead: "0x0000000000000000000000000000000000000000000000000000000000000000",
        recordHash:
          "keccak256(abi.encode(STORY_RECORD_DOMAIN, uint256(chainId), address(archive), uint256(tokenId), uint64(index), bytes32(schemaId), bytes32(payloadHash), uint64(payloadLength), address(author), uint64(timestamp)))",
        newHead:
          "keccak256(abi.encode(STORY_HEAD_DOMAIN, bytes32(previousHead), bytes32(recordHash)))",
        seal: "owner only; expected count/head; nonempty; irreversible",
        initialization: {
          authorization: "msg.sender == DEEP_FAMILY",
          maximumCalls: 1,
          emptyPayload: "hash verified; no record; initialization remains consumed",
          author: "actual minter",
          timing: "before ERC721 receiver callback; atomic with mint",
          schemaId: "0x22253a7cc8948414ca943f8c643c363f1c46ea9d5d77ee6949bd5ff0f6b5ae86",
        },
        publicEnvelope: {
          magic: "DFSE",
          schema: "deepfamily/story-envelope@1.0",
          biographySchema: "deepfamily/story-biography-envelope@1.0",
          formatVersion: 1,
          headerBytes: 48,
          plaintextCodec: 1,
          compressionSuite: 1,
          compression: "gzip-v1; level 6; mtime 0; one member; no trailing data",
          automaticFallback: false,
          maximumOriginalBytes: 16777216,
          offsets: {
            magic: 0,
            formatVersion: 4,
            plaintextCodec: 5,
            compressionSuite: 6,
            flags: 7,
            originalLength: 8,
            originalHash: 16,
            body: 48,
          },
          originalHash: "keccak256(complete canonical story JSON bytes)",
          biographyType: 0,
          editableTypes: [1, 19],
        },
      },
      blob: {
        emptyPayload: "rejected",
        totalPayloadLimit: null,
        singleSegment: "0x00 || payload",
        multipleSegments: "DFBP version-1 paged manifest; STOP-prefixed 16384-byte segments",
        manifestHeaderBytes: 86,
        manifestMaxRuntimeBytes: 20566,
        manifestIntegers: "big-endian",
        atomic: true,
      },
    },
  },
  deepFamilyReader: {
    abiPolicy: {
      nonErrorFragments: "declared-subset",
      errorFragments: "excluded",
    },
    abi: [
      {
        type: "constructor",
        stateMutability: "nonpayable",
        inputs: [
          {
            name: "deepFamily",
            type: "address",
          },
        ],
      },
      {
        type: "function",
        name: "ARCHIVE",
        selector: "0xcbd7aee9",
        stateMutability: "view",
        inputs: [],
        outputs: [
          {
            name: "",
            type: "address",
          },
        ],
      },
      {
        type: "function",
        name: "DEEP_FAMILY",
        selector: "0x4130d94c",
        stateMutability: "view",
        inputs: [],
        outputs: [
          {
            name: "",
            type: "address",
          },
        ],
      },
      {
        type: "function",
        name: "getStoryRecordRef",
        selector: "0x9deeb9b4",
        stateMutability: "view",
        inputs: [
          {
            name: "tokenId",
            type: "uint256",
          },
          {
            name: "index",
            type: "uint64",
          },
        ],
        outputs: [
          {
            name: "record",
            type: "tuple",
            components: [
              {
                name: "blob",
                type: "tuple",
                components: [
                  {
                    name: "payloadHash",
                    type: "bytes32",
                  },
                  {
                    name: "pointer",
                    type: "address",
                  },
                  {
                    name: "payloadLength",
                    type: "uint64",
                  },
                  {
                    name: "segmentCount",
                    type: "uint32",
                  },
                ],
              },
              {
                name: "schemaId",
                type: "bytes32",
              },
              {
                name: "author",
                type: "address",
              },
              {
                name: "timestamp",
                type: "uint64",
              },
            ],
          },
        ],
      },
      {
        type: "function",
        name: "getStoryState",
        selector: "0x65b8819c",
        stateMutability: "view",
        inputs: [
          {
            name: "tokenId",
            type: "uint256",
          },
        ],
        outputs: [
          {
            name: "state",
            type: "tuple",
            components: [
              {
                name: "recordsHead",
                type: "bytes32",
              },
              {
                name: "totalRecords",
                type: "uint64",
              },
              {
                name: "totalPayloadLength",
                type: "uint64",
              },
              {
                name: "lastUpdateTime",
                type: "uint64",
              },
              {
                name: "isSealed",
                type: "bool",
              },
            ],
          },
        ],
      },
      {
        type: "function",
        name: "getVersionMetadataRef",
        selector: "0x72b543c4",
        stateMutability: "view",
        inputs: [
          {
            name: "personHash",
            type: "bytes32",
          },
          {
            name: "versionIndex",
            type: "uint256",
          },
        ],
        outputs: [
          {
            name: "metadata",
            type: "tuple",
            components: [
              {
                name: "payloadHash",
                type: "bytes32",
              },
              {
                name: "pointer",
                type: "address",
              },
              {
                name: "payloadLength",
                type: "uint64",
              },
              {
                name: "segmentCount",
                type: "uint32",
              },
            ],
          },
        ],
      },
      {
        type: "function",
        name: "listStoryRecords",
        selector: "0x8a822679",
        stateMutability: "view",
        inputs: [
          {
            name: "tokenId",
            type: "uint256",
          },
          {
            name: "offset",
            type: "uint256",
          },
          {
            name: "limit",
            type: "uint256",
          },
        ],
        outputs: [
          {
            name: "records",
            type: "tuple[]",
            components: [
              {
                name: "blob",
                type: "tuple",
                components: [
                  {
                    name: "payloadHash",
                    type: "bytes32",
                  },
                  {
                    name: "pointer",
                    type: "address",
                  },
                  {
                    name: "payloadLength",
                    type: "uint64",
                  },
                  {
                    name: "segmentCount",
                    type: "uint32",
                  },
                ],
              },
              {
                name: "schemaId",
                type: "bytes32",
              },
              {
                name: "author",
                type: "address",
              },
              {
                name: "timestamp",
                type: "uint64",
              },
            ],
          },
          {
            name: "totalRecords",
            type: "uint256",
          },
          {
            name: "hasMore",
            type: "bool",
          },
          {
            name: "nextOffset",
            type: "uint256",
          },
        ],
      },
    ],
    semantics: {
      immutableBindings: {
        DEEP_FAMILY: "constructor.deepFamily",
        ARCHIVE: "DEEP_FAMILY.archive() at construction",
      },
      constructorChecks: {
        deepFamilyHasCode: true,
        archiveHasCode: true,
        archiveReverseBinding: "ARCHIVE.DEEP_FAMILY() == DEEP_FAMILY",
      },
      getVersionMetadataRef: {
        versionIndexing: "one-based",
        requiresExistingVersion: true,
        source: "ARCHIVE.metadataRef(personHash,versionIndex)",
      },
      storyPaginationMaximum: 100,
      largeBytesReturned: false,
    },
  },
  deepFamily: {
    abiPolicy: {
      nonErrorFragments: "declared-subset",
      errorFragments: "excluded",
    },
    abi: [
      {
        type: "event",
        name: "ArchiveSet",
        topic0: "0x40dbea9d89786287e5692bdf8342b106edf4bdd3ab2bdb236bf07c212ed829f4",
        anonymous: false,
        inputs: [
          {
            name: "archive",
            type: "address",
            indexed: true,
          },
        ],
      },
      {
        type: "function",
        name: "archive",
        selector: "0x02a21460",
        stateMutability: "view",
        inputs: [],
        outputs: [
          {
            name: "",
            type: "address",
          },
        ],
      },
      {
        type: "function",
        name: "setArchive",
        selector: "0x499dfd71",
        stateMutability: "nonpayable",
        inputs: [
          {
            name: "candidate",
            type: "address",
          },
        ],
        outputs: [],
      },
      {
        type: "function",
        name: "mintPersonVersionNFT",
        selector: "0x51d634e3",
        stateMutability: "nonpayable",
        inputs: [
          {
            name: "proof",
            type: "tuple",
            components: [
              {
                name: "circuitId",
                type: "uint32",
              },
              {
                name: "proofEncodingId",
                type: "uint8",
              },
              {
                name: "proofData",
                type: "bytes",
              },
            ],
          },
          {
            name: "publicSignals",
            type: "tuple",
            components: [
              {
                name: "identityCommitment",
                type: "uint256",
              },
              {
                name: "disclosureBinding",
                type: "uint256",
              },
              {
                name: "minter",
                type: "uint256",
              },
              {
                name: "suiteCommitment",
                type: "uint256",
              },
            ],
          },
          {
            name: "versionIndex",
            type: "uint256",
          },
          {
            name: "_tokenURI",
            type: "string",
          },
          {
            name: "coreInfo",
            type: "tuple",
            components: [
              {
                name: "basicInfo",
                type: "tuple",
                components: [
                  {
                    name: "identityCommitment",
                    type: "bytes32",
                  },
                  {
                    name: "isBirthBC",
                    type: "bool",
                  },
                  {
                    name: "birthYear",
                    type: "uint16",
                  },
                  {
                    name: "birthMonth",
                    type: "uint8",
                  },
                  {
                    name: "birthDay",
                    type: "uint8",
                  },
                  {
                    name: "gender",
                    type: "uint8",
                  },
                ],
              },
              {
                name: "supplementInfo",
                type: "tuple",
                components: [
                  {
                    name: "fullName",
                    type: "string",
                  },
                  {
                    name: "birthPlace",
                    type: "string",
                  },
                  {
                    name: "isDeathBC",
                    type: "bool",
                  },
                  {
                    name: "deathYear",
                    type: "uint16",
                  },
                  {
                    name: "deathMonth",
                    type: "uint8",
                  },
                  {
                    name: "deathDay",
                    type: "uint8",
                  },
                  {
                    name: "deathPlace",
                    type: "string",
                  },
                ],
              },
            ],
          },
          {
            name: "storyPayload",
            type: "bytes",
          },
          {
            name: "expectedStoryPayloadHash",
            type: "bytes32",
          },
        ],
        outputs: [],
      },
    ],
    semantics: {
      archiveStorageSlots: 1,
      initialValue: "address(0)",
      setterAuthorization: "owner via proxy",
      setterCallsMaximum: 1,
      archiveHasCode: true,
      archiveReverseBinding: "IDeepFamilyArchiveV1(candidate).DEEP_FAMILY() == address(this)",
      archiveKind: "0xbc9b8c5e2836ffe8b3db14ba7b3e2b5a7c8714f4a9e01b435aad3396f45af12c",
      apiVersion: 1,
      erc165: true,
      mintBiography:
        "optional compressed payload; initialized in Archive before safeMint; no supplementInfo.story",
    },
  },
};
export const expectedContractInterfaces = () => structuredClone(definition);
