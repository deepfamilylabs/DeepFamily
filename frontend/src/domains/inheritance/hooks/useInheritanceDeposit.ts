import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InheritanceError, toInheritanceFriendlyError } from "../model/inheritanceErrors";
import type { DepositState } from "../model/inheritanceTypes";
import { readInheritance } from "../services/inheritanceChain";
import { assertWalletChain, depositFlow, type TokenContract } from "../services/inheritanceFlows";
import { connectInheritanceWriters } from "../services/inheritanceModules";
import type { InheritanceSession } from "./inheritanceSession";

/** Anyone may top up an inheritance by its id; the lookup shows what the deposit joins. */
export function useInheritanceDeposit(session: InheritanceSession | null) {
  const { t } = useTranslation();
  const [state, setState] = useState<DepositState>({ step: "idle" });
  const runRef = useRef(0);

  const reset = useCallback(() => {
    runRef.current += 1;
    setState({ step: "idle" });
  }, []);

  const lookup = useCallback(
    async (id: bigint) => {
      if (!session) return;
      const run = ++runRef.current;
      setState({ step: "loading" });
      try {
        const info = await readInheritance(session.modules.inheritance, id);
        if (run === runRef.current) setState({ step: "found", info });
      } catch (error) {
        if (run !== runRef.current) return;
        setState({
          step: "error",
          error: toInheritanceFriendlyError(error, t, session.modules.inheritance),
        });
      }
    },
    [session, t],
  );

  const deposit = useCallback(
    async (amount: bigint) => {
      const info = state.step === "found" || state.step === "error" ? state.info : undefined;
      if (!session || !info) return;
      const run = ++runRef.current;
      const writers = connectInheritanceWriters(session.modules, session.signer);
      try {
        const balance = BigInt(await session.modules.token.balanceOf(session.account));
        if (balance < amount) throw new InheritanceError("insufficientBalance");
        await assertWalletChain(session.signer, session.modules.chainId);
        const result = await depositFlow({
          inheritance: writers.inheritance,
          token: writers.token as unknown as TokenContract,
          owner: session.account,
          amount,
          id: info.id,
          onStage: (stage) => {
            if (run === runRef.current) setState({ step: stage, info });
          },
        });
        const updated = await readInheritance(session.modules.inheritance, info.id).catch(() => ({
          ...info,
          balance: info.balance + amount,
        }));
        if (run === runRef.current) setState({ step: "success", info: updated, amount, ...result });
      } catch (error) {
        if (run !== runRef.current) return;
        setState({
          step: "error",
          info,
          error: toInheritanceFriendlyError(error, t, writers.inheritance),
        });
      }
    },
    [session, state, t],
  );

  return { state, lookup, deposit, reset };
}
