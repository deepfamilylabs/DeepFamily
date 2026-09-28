import { isMetadataUnlockUsable, isMinted, type NodeData } from "../../../shared/model";

export type ShieldedRecipientKind = "child" | "recipient";

export type ShieldedRecipientOption = {
  personHash: string;
  label?: string;
  registered: boolean;
  eligible?: boolean;
};

export type ShieldedRecipientError =
  | "loading"
  | "empty"
  | "invalidHash"
  | "notEligibleChild"
  | "notRegistered";

const PERSON_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Only names already available in the local tree are shown; private names need a valid unlock. */
export function getShieldedLocalRecipientLabels(
  nodesData: Readonly<Record<string, NodeData>>,
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const node of Object.values(nodesData)) {
    if (!PERSON_HASH.test(node.personHash)) continue;
    const name = isMetadataUnlockUsable(node)
      ? node.metadataPerson?.fullName?.trim()
      : isMinted(node)
        ? node.fullName?.trim()
        : undefined;
    if (name) labels.set(node.personHash.toLowerCase(), name);
  }
  return labels;
}

/** The full hash is always validated after a manual paste or a list selection. */
export function validateShieldedRecipientSelection({
  kind,
  value,
  options,
  loading,
}: {
  kind: ShieldedRecipientKind;
  value: string;
  options: readonly ShieldedRecipientOption[];
  loading: boolean;
}): ShieldedRecipientError | undefined {
  const hash = value.trim();
  if (!hash) return "empty";
  if (!PERSON_HASH.test(hash)) return "invalidHash";
  if (loading) return "loading";
  const option = options.find((item) => item.personHash.toLowerCase() === hash.toLowerCase());
  if (kind === "child" && !option?.eligible) return "notEligibleChild";
  if (!option?.registered) return "notRegistered";
  return undefined;
}
