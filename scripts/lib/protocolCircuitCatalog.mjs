// One public ABI catalogue for the receive protocol. Development and formal
// artifact workflows consume the same relations; their keys remain separate.
export const PROTOCOL_CIRCUITS = Object.freeze({
  sourceFact: Object.freeze({
    source: "eligibility_source_fact",
    contract: "EligibilitySourceFactVerifier",
    publicSignals: 10,
  }),
  sourceTrust: Object.freeze({
    source: "eligibility_source_trust",
    contract: "EligibilitySourceTrustVerifier",
    publicSignals: 8,
  }),
  issue: Object.freeze({
    source: "eligibility_issue",
    contract: "EligibilityIssueVerifier",
    publicSignals: 5,
  }),
  code: Object.freeze({
    source: "receive_code",
    contract: "ReceiveCodeVerifier",
    publicSignals: 10,
  }),
  capability: Object.freeze({
    source: "budget_capability",
    contract: "BudgetCapabilityVerifier",
    publicSignals: 10,
  }),
  fund: Object.freeze({
    source: "budget_deposit",
    contract: "BudgetDepositVerifier",
    publicSignals: 20,
  }),
  claim: Object.freeze({
    source: "budget_claim",
    contract: "BudgetClaimVerifier",
    publicSignals: 23,
  }),
  transfer: Object.freeze({
    source: "value_transfer",
    contract: "ValueTransferVerifier",
    publicSignals: 12,
  }),
});
