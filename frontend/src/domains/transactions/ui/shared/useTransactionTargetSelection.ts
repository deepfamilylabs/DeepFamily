import { useCallback, useEffect, useRef, useState } from "react";
import { usePersonVersionOptions } from "../../hooks/usePersonVersionOptions";

export type VersionDecision = { decidedForHash: string; versionIndex: number } | null;

const isBytes32 = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value.trim());

/**
 * Which person version a modal is aimed at, and why.
 *
 * The subtlety is `decidedForHash`: a version lookup resolves asynchronously,
 * and must never overwrite a choice the caller pinned or the user just made.
 * Both targeted flows had this same dance written out twice; the rule of who
 * gets to move the index lives here instead.
 *
 * Deliberately not included: what each flow clears when the target moves, and
 * which version a lookup should preselect. Both are genuinely per-flow — minting
 * can only target a version you already endorsed, endorsing prefers the most
 * endorsed one — so the controllers keep those and feed decisions back in.
 */
export function useTransactionTargetSelection(input: { isOpen: boolean }) {
  const { isOpen } = input;
  const [personHash, setPersonHash] = useState("");
  // 0 means "no version chosen yet"; hasValidTarget already requires > 0, so an
  // unchosen target cannot be submitted.
  const [versionIndex, setVersionIndex] = useState(0);
  const decidedVersionHashRef = useRef<string | null>(null);
  const hadValidHashRef = useRef(false);

  const targetPersonHash = personHash.trim();
  const isPersonHashFormatValid = isBytes32(targetPersonHash);
  const hasValidTarget = Boolean(targetPersonHash && isPersonHashFormatValid && versionIndex > 0);
  const hashInputInvalid = Boolean(targetPersonHash && !isPersonHashFormatValid);

  // Owned here rather than passed in: the lookup is derived from the hash this
  // hook holds, so taking it as an argument would be circular.
  const versionLookup = usePersonVersionOptions(
    isOpen && isPersonHashFormatValid ? targetPersonHash : null,
  );

  /**
   * Points the modal at a target. A caller that names a version means that
   * exact version, so it is pinned; a target the user has to fill in themselves
   * stays open to preselection.
   */
  const seedTarget = useCallback((nextHash: string, nextIndex: number) => {
    // An empty hash names nothing, so there is no decision to pin to it.
    decidedVersionHashRef.current = nextIndex && nextHash.trim() ? nextHash.trim() : null;
    setPersonHash(nextHash);
    setVersionIndex(nextIndex);
  }, []);

  const handleVersionIndexChange = useCallback(
    (value: number) => {
      // Freeze the decision for this hash so a still-running lookup cannot
      // overwrite it once it resolves.
      decidedVersionHashRef.current = versionLookup.personHash ?? targetPersonHash;
      setVersionIndex(value);
    },
    [targetPersonHash, versionLookup.personHash],
  );

  useEffect(() => {
    const hadValidHash = hadValidHashRef.current;
    hadValidHashRef.current = isPersonHashFormatValid;
    // Only on the transition out of a valid hash. The first render always sees
    // the empty initial state, and clearing there would drop a caller's target.
    if (isPersonHashFormatValid || !hadValidHash) return;
    // The hash no longer names a target, so a version chosen for the previous
    // one must not linger and re-appear as a bare "Version 1".
    decidedVersionHashRef.current = null;
    setVersionIndex(0);
  }, [isPersonHashFormatValid]);

  /** The hash the current index was decided for, for a caller's reconciler. */
  const getDecidedVersionHash = useCallback(() => decidedVersionHashRef.current, []);

  const applyVersionDecision = useCallback((decision: VersionDecision) => {
    if (!decision) return;
    decidedVersionHashRef.current = decision.decidedForHash;
    setVersionIndex(decision.versionIndex);
  }, []);

  return {
    personHash,
    setPersonHash,
    versionIndex,
    targetPersonHash,
    isPersonHashFormatValid,
    hasValidTarget,
    hashInputInvalid,
    versionLookup,
    seedTarget,
    handleVersionIndexChange,
    getDecidedVersionHash,
    applyVersionDecision,
  };
}
