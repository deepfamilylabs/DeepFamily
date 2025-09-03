# DeepFamily Architecture

## Overview
DeepFamily is a modular on-chain genealogy protocol composed of:
- Core contract `DeepFamily.sol`
- Mining token `DeepFamilyToken.sol`
- ZK verifier implementing `IPersonHashVerifier`
- React frontend (Vite + Ethers v6)
- The Graph subgraph for indexing events

## Dual Network Model
Layer 1: Relationship Graph
- Nodes: `PersonHash` (aggregating all versions) & individual `PersonVersion` entries.
- Edges: Parent ↔ Child references (directed), forming an acyclic genealogical graph (local DAG segments; global cycles prevented by biological constraints + social curation).
- Purpose: Establish verifiable lineage topology & temporal anchoring (timestamps, version provenance).

Layer 2: Value & Incentive Graph
- Nodes: Person Version NFTs (unique per accepted version) + participant addresses.
- Edges / Flows:
  * Endorsement fee payments (DEEP ERC20) shifting social weight to a version.
  * Mining reward emissions on qualified adds (with both parents) distributing new DEEP to creators.
  * NFT ownership transfers re-routing future endorsement revenue stream.
  * Story shard contributions increasing perceived cultural / historical value (off-chain market signaling).
- Purpose: Align economic incentives with data accuracy & narrative completeness; concentrate future fee flows on socially converged best versions.

Interplay
- Accurate parent linkage on Layer 1 → unlock mining reward (Layer 2) → higher dynamic endorsement cost discourages spam → endorsement consolidation feeds back as a social quality signal guiding which version gets NFT minted.
- NFT value appreciation (Layer 2) motivates continued curation & story enrichment, indirectly improving reliability of the underlying relationship graph (Layer 1).

Analytics Implications
- Two-layer abstraction enables distinct indexing domains: structural lineage queries (ancestry, descendants) vs. economic/engagement analytics (endorsement velocity, reward decay, NFT turnover).
- Future subgraph schemas can expose composite metrics (e.g., credibility score = f(endorsements, story completeness, lineage depth).

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