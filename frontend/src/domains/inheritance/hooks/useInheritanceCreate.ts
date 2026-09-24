import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { computeInheritanceCredential } from "@deepfamily/protocol-core";
import { InheritanceError, toInheritanceFriendlyError } from "../model/inheritanceErrors";
import type { CreateState, IdentityFormRef } from "../model/inheritanceTypes";
import {
  assertIdentityKnown,
  assertVersionKnown,
  countTrustedEndorsers,
  loadRootRegistry,
} from "../services/inheritanceChain";
import {
  assertWalletChain,
  createInheritanceFlow,
  type TokenContract,
} from "../services/inheritanceFlows";
import { deriveIdentityFromForm } from "../services/inheritanceIdentity";
import { connectInheritanceWriters } from "../services/inheritanceModules";
import type { InheritanceSession } from "./inheritanceSession";

export interface CreateReviewInput {
  rootVersionIndex: number;
  amountPerPeriod: bigint;
  amount: bigint;
}

/**
 * Two steps, because a deposit can never come back: `review` derives the root's credential and
 * confirms, from a full event scan that names nobody, that the root version exists (a mistyped
 * passphrase gives an identity that does not); `confirm` then approves and creates exactly what
 * was reviewed.
 */
export function useInheritanceCreate(
  session: InheritanceSession | null,
  rootForm: IdentityFormRef,
) {
  const { t } = useTranslation();
  const [state, setState] = useState<CreateState>({ step: "idle" });
  // Each run gets a ticket; a reset or a newer run makes older results stale.
  const runRef = useRef(0);

  const reset = useCallback(() => {
    runRef.current += 1;
    setState({ step: "idle" });
  }, []);

  const review = useCallback(
    async (input: CreateReviewInput) => {
      if (!session) return;
      const run = ++runRef.current;
      const { modules, account } = session;
      try {
        if (!Number.isSafeInteger(input.rootVersionIndex) || input.rootVersionIndex < 1) {
          throw new InheritanceError("invalidVersionIndex");
        }
        setState({ step: "deriving" });
        const root = await deriveIdentityFromForm(rootForm.current);
        if (run !== runRef.current) return;

        setState({ step: "checking" });
        const [registry, balance] = await Promise.all([
          loadRootRegistry(modules.lineageIndex, modules.deepFamily),
          modules.token.balanceOf(account) as Promise<bigint>,
        ]);
        assertIdentityKnown(registry, root, "rootNotFound");
        assertVersionKnown(registry, root.personHash, input.rootVersionIndex);
        if (BigInt(balance) < input.amount) throw new InheritanceError("insufficientBalance");
        const credential = computeInheritanceCredential({
          rootIdentityCommitment: root.identityCommitment,
          rootVersionIndex: input.rootVersionIndex,
          rootDerivedSecretField: root.derivedSecretField,
        });
        if (run !== runRef.current) return;
        setState({
          step: "review",
          review: {
            credential,
            rootPersonHash: root.personHash,
            rootVersionIndex: input.rootVersionIndex,
            trustedEndorserCount: countTrustedEndorsers(
              registry,
              root.personHash,
              input.rootVersionIndex,
            ),
            amountPerPeriod: input.amountPerPeriod,
            amount: input.amount,
          },
        });
      } catch (error) {
        if (run !== runRef.current) return;
        setState({ step: "error", error: toInheritanceFriendlyError(error, t) });
      }
    },
    [session, rootForm, t],
  );

  const confirm = useCallback(async () => {
    if (!session || state.step !== "review") return;
    const run = ++runRef.current;
    const { review: reviewed } = state;
    const writers = connectInheritanceWriters(session.modules, session.signer);
    try {
      await assertWalletChain(session.signer, session.modules.chainId);
      const result = await createInheritanceFlow({
        inheritance: writers.inheritance,
        token: writers.token as unknown as TokenContract,
        owner: session.account,
        amount: reviewed.amount,
        credential: reviewed.credential,
        amountPerPeriod: reviewed.amountPerPeriod,
        onStage: (stage) => {
          if (run === runRef.current) setState({ step: stage, review: reviewed });
        },
      });
      if (run !== runRef.current) return;
      setState({ step: "success", review: reviewed, ...result });
    } catch (error) {
      if (run !== runRef.current) return;
      setState({
        step: "error",
        error: toInheritanceFriendlyError(error, t, writers.inheritance),
      });
    }
  }, [session, state, t]);

  return { state, review, confirm, reset };
}
