import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ethers } from "ethers";
import {
  computeInheritanceClaimTag,
  computeInheritanceCredential,
} from "@deepfamily/protocol-core";
import { zkWorkerCall } from "../../../shared/workers/zkWorkerClient";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import { InheritanceError, toInheritanceFriendlyError } from "../model/inheritanceErrors";
import type {
  ClaimLookup,
  ClaimRowView,
  ClaimState,
  IdentityFormRef,
} from "../model/inheritanceTypes";
import {
  assertIdentityKnown,
  assertVersionKnown,
  findHeirLegitimacy,
  latestBlockTime,
  listInheritancesForCredential,
  loadLineageSnapshot,
  readInheritanceRow,
  type HeirLegitimacy,
  type LineageSnapshot,
} from "../services/inheritanceChain";
import {
  assertWalletChain,
  prepareClaim,
  submitClaim,
  summarizeClaim,
} from "../services/inheritanceFlows";
import { deriveIdentityFromForm } from "../services/inheritanceIdentity";
import { connectInheritanceWriters, type InheritanceModules } from "../services/inheritanceModules";
import type { InheritanceSession } from "./inheritanceSession";

const PROOF_TIMEOUT_MS = 300_000;

type Resolved = {
  heir: IdentityMaterialV1Result;
  root: IdentityMaterialV1Result;
  snapshot: LineageSnapshot;
  /** Oldest first: the earliest endorsement opens the earliest period. */
  legitimacy: HeirLegitimacy;
  credential: bigint;
  claimTag: bigint;
};

/**
 * Derives both identities from the forms (read now, never stored), replays the lineage and
 * endorsement events, checks both people exist, and finds the heir's endorsement by one of the
 * root version's trusted endorsers. The RPC node sees only full event scans. Search and claim both
 * run it, so no secret outlives the click that needed it.
 */
async function resolveHeir(
  modules: InheritanceModules,
  heirForm: IdentityFormRef,
  rootForm: IdentityFormRef,
  rootVersionIndex: number,
  onScanning: () => void,
): Promise<Resolved> {
  if (!Number.isSafeInteger(rootVersionIndex) || rootVersionIndex < 1) {
    throw new InheritanceError("invalidVersionIndex");
  }
  const heir = await deriveIdentityFromForm(heirForm.current);
  const root = await deriveIdentityFromForm(rootForm.current);

  onScanning();
  const snapshot = await loadLineageSnapshot(modules.lineageIndex, modules.deepFamily);
  assertIdentityKnown(snapshot, heir, "heirNotFound");
  assertIdentityKnown(snapshot, root, "rootNotFound");
  assertVersionKnown(snapshot, root.personHash, rootVersionIndex);
  const [legitimacy] = findHeirLegitimacy({ snapshot, heir, root, rootVersionIndex });
  if (!legitimacy) throw new InheritanceError("notLegitHeir");

  const credential = computeInheritanceCredential({
    rootIdentityCommitment: root.identityCommitment,
    rootVersionIndex,
    rootDerivedSecretField: root.derivedSecretField,
  });
  const claimTag = computeInheritanceClaimTag({
    derivedSecretField: heir.derivedSecretField,
    inheritanceCredential: credential,
  });
  return { heir, root, snapshot, legitimacy, credential, claimTag };
}

/** Search lists every inheritance under the root version; claim proves and pays one of them. */
export function useInheritanceClaim(
  session: InheritanceSession | null,
  heirForm: IdentityFormRef,
  rootForm: IdentityFormRef,
) {
  const { t } = useTranslation();
  const [state, setState] = useState<ClaimState>({ step: "idle" });
  const runRef = useRef(0);

  const reset = useCallback(() => {
    runRef.current += 1;
    setState({ step: "idle" });
  }, []);

  const search = useCallback(
    async (rootVersionIndex: number) => {
      if (!session) return;
      const run = ++runRef.current;
      const { modules } = session;
      const stillCurrent = () => run === runRef.current;
      setState({ step: "searching", stage: "deriving" });
      try {
        const resolved = await resolveHeir(modules, heirForm, rootForm, rootVersionIndex, () => {
          if (stillCurrent()) setState({ step: "searching", stage: "scanning" });
        });
        const [rows, now] = await Promise.all([
          listInheritancesForCredential(
            modules.inheritance,
            resolved.credential,
            resolved.claimTag,
          ),
          latestBlockTime(modules.provider),
        ]);
        if (!stillCurrent()) return;
        const views: ClaimRowView[] = rows.map((row) => ({
          id: row.id,
          startTime: row.startTime,
          amountPerPeriod: row.amountPerPeriod,
          balance: row.balance,
          claimed: row.claimed,
          ...summarizeClaim(row, resolved.legitimacy.writtenAt, now),
        }));
        setState({
          step: "found",
          lookup: {
            heirPersonHash: resolved.heir.personHash,
            rootPersonHash: resolved.root.personHash,
            rootVersionIndex,
            versionIndex: resolved.legitimacy.versionIndex,
            endorser: resolved.legitimacy.endorser,
            rows: views,
          },
        });
      } catch (error) {
        if (stillCurrent()) {
          setState({
            step: "error",
            error: toInheritanceFriendlyError(error, t, modules.inheritance),
          });
        }
      }
    },
    [session, heirForm, rootForm, t],
  );

  const claim = useCallback(
    async (id: bigint, recipient: string) => {
      const lookup =
        state.step === "found" || state.step === "claimed" || state.step === "error"
          ? state.lookup
          : undefined;
      if (!session || !lookup) return;
      const run = ++runRef.current;
      const { modules, signer } = session;
      const stillCurrent = () => run === runRef.current;
      const stage = (next: "deriving" | "scanning" | "proving" | "submitting") => {
        if (stillCurrent()) setState({ step: "claiming", lookup, id, stage: next });
      };
      const writers = connectInheritanceWriters(modules, signer);
      stage("deriving");
      try {
        if (!ethers.isAddress(recipient) || BigInt(recipient) === 0n) {
          throw new InheritanceError("invalidRecipient");
        }
        const resolved = await resolveHeir(
          modules,
          heirForm,
          rootForm,
          lookup.rootVersionIndex,
          () => stage("scanning"),
        );
        // The forms may have been edited since the search; claim only for the people it found.
        if (
          resolved.heir.personHash !== lookup.heirPersonHash ||
          resolved.root.personHash !== lookup.rootPersonHash
        ) {
          throw new InheritanceError("identityChanged");
        }
        const [row, now] = await Promise.all([
          readInheritanceRow(modules.inheritance, id, resolved.claimTag),
          latestBlockTime(modules.provider),
        ]);
        const preview = prepareClaim({
          heir: resolved.heir,
          root: resolved.root,
          rootVersionIndex: lookup.rootVersionIndex,
          legitimacy: resolved.legitimacy,
          snapshot: resolved.snapshot,
          row,
          recipient: ethers.getAddress(recipient),
          now,
        });
        if (!preview.ready) throw new InheritanceError("notEligibleYet");
        if (preview.claimable === 0n) throw new InheritanceError("nothingToClaim");

        stage("proving");
        const { proof } = await zkWorkerCall(
          "generateInheritanceClaimProof",
          { witness: preview.witness },
          { timeoutMs: PROOF_TIMEOUT_MS },
        );

        stage("submitting");
        await assertWalletChain(signer, modules.chainId);
        const result = await submitClaim({
          inheritance: writers.inheritance,
          id,
          signals: preview.signals,
          proof,
        });
        if (!stillCurrent()) return;
        const rows = lookup.rows.map((view) => {
          if (view.id !== id) return view;
          const balance = view.balance - result.amount;
          const owed = view.owed > result.amount ? view.owed - result.amount : 0n;
          return {
            ...view,
            balance,
            claimed: view.claimed + result.amount,
            owed,
            claimable: owed < balance ? owed : balance,
          };
        });
        setState({ step: "claimed", lookup: { ...lookup, rows }, id, ...result });
      } catch (error) {
        if (stillCurrent()) {
          setState({
            step: "error",
            lookup,
            error: toInheritanceFriendlyError(error, t, writers.inheritance),
          });
        }
      }
    },
    [session, state, heirForm, rootForm, t],
  );

  return { state, search, claim, reset };
}
