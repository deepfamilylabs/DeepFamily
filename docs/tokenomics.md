# Tokenomics

## Supply & Emission
- Hard cap: 100B DEEP (enforced by `MAX_SUPPLY`)
- Initial per-qualified-add reward: 113,777 DEEP
- Halving schedule: variable cycle lengths doubling duration each step until fixed length (100M) repeating.
- Termination: when reward < 0.1 DEEP or cap hit.

## Incentive Alignment
1. Contributor adds person (with both parents) -> mining reward
2. Endorser pays current reward amount to shift endorsement -> cost tracks issuance to stabilize inflationary pressure
3. NFT holder shares endorsement fee (50% if different from author) -> encourages minting & curation
4. Story completeness (non-monetary) drives perceived historical value.

## Economic Attack Considerations
| Vector | Mitigation |
|--------|------------|
| Sybil mass adds w/o parents | Reward requires existing both parent versions |
| Cheap endorsement spam | Cost = dynamic `recentReward` (rises early) |
| NFT squatting | Must endorse first (cost), one NFT per version |
| Version grief edits | New version instead of edit; endorsements migrate socially |