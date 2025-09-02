# DeepFamily Architecture

## Overview
DeepFamily is a modular on-chain genealogy protocol composed of:
- Core contract `DeepFamily.sol`
- Mining token `DeepFamilyToken.sol`
- (Planned) ZK verifier implementing `IPersonHashVerifier`
- React frontend (Vite + Ethers v6)
- The Graph subgraph for indexing events

## Data Flow (Happy Path)
1. User submits person version (optionally with parent versions present).
2. If both parents exist -> `DeepFamilyToken.mint` distributes mining reward.
3. Other users endorse a version by paying the current `recentReward`.
4. Endorser can mint NFT for the endorsed version, storing core info on-chain.
5. NFT owner adds story shards; once sealed, story becomes immutable.
6. Subgraph indexes events for UI queries beyond on-chain pagination.

## Key Incentive Loop
Accurate parent linkage -> mining reward -> endorsement cost ties to reward -> NFT holder share -> encourages consolidation on best version.

## Storage Strategy
- Minimal identifying fields on-chain (hashed person identity + structured metadata).
- Extended biography off-chain IPFS chunks referenced indirectly via story sharding.

## Upgradability Strategy
Current contracts are NOT upgradeable; governance & upgrade proxy patterns are deferred until protocol stabilization + audit.

## Future Modules
- ZK circuits for private attribute confirmation.