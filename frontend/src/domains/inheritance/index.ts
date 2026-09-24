export { useInheritanceModules } from "./hooks/useInheritanceModules";
export type {
  InheritanceModulesInput,
  InheritanceModulesState,
} from "./hooks/useInheritanceModules";
export { useInheritanceCreate } from "./hooks/useInheritanceCreate";
export { useInheritanceDeposit } from "./hooks/useInheritanceDeposit";
export { useInheritanceClaim } from "./hooks/useInheritanceClaim";
export type { InheritanceSession } from "./hooks/inheritanceSession";
export type {
  IdentityFormHandle,
  IdentityFormRef,
  InheritanceBlocker,
} from "./model/inheritanceTypes";
export { InheritanceGate, InheritanceNotice } from "./ui/InheritanceNotice";
export { InheritanceCreatePanel } from "./ui/InheritanceCreatePanel";
export { InheritanceDepositPanel } from "./ui/InheritanceDepositPanel";
export { InheritanceClaimPanel } from "./ui/InheritanceClaimPanel";
