import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wallet } from "lucide-react";
import { useConfig } from "../domains/config";
import { ShieldedInheritancePanel, type ShieldedPageModules } from "../domains/inheritance";
import { useWallet, WalletConnectButton } from "../domains/wallet";
import {
  createDeepFamilyContract,
  createDeepTokenContract,
  createLineageIndexContract,
  createShieldedPoolContract,
} from "../shared/clients/contractFactory";
import { getReadonlyProvider } from "../shared/clients/providerRegistry";
import { getShieldedPoolAddress } from "../shared/config/env";
import { EmptyState, PageContainer, PageHead } from "../shared/ui";

type ModulesState =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; modules: ShieldedPageModules };

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export default function InheritancePage() {
  const { t } = useTranslation();
  const config = useConfig();
  const wallet = useWallet();
  const poolAddress = getShieldedPoolAddress(config.chainId);
  const configurationMissing = t("shielded.configurationMissing");
  const configurationMismatch = t("shielded.configurationMismatch");
  const invalidDecimals = t("shielded.invalidDecimals");
  const unreachable = t("shielded.unreachable");
  const [state, setState] = useState<ModulesState>({ status: "loading" });
  // Kept across wallet switches during this page visit so a public deposit wallet
  // cannot be reused immediately for private actions.
  const publicActivityAddresses = useRef(new Set<string>());

  useEffect(() => {
    if (!config.rpcUrl || !config.contractAddress || !config.tokenAddress || !poolAddress) {
      setState({ status: "unavailable", message: configurationMissing });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const load = async () => {
      const provider = getReadonlyProvider(config.rpcUrl, config.chainId);
      const deepFamily = createDeepFamilyContract(config.contractAddress, provider);
      const token = createDeepTokenContract(config.tokenAddress, provider);
      const pool = createShieldedPoolContract(poolAddress, provider);
      const [network, familyIndex, poolIndex, poolToken, decimals] = await Promise.all([
        provider.getNetwork(),
        deepFamily.lineageIndex() as Promise<string>,
        pool.LINEAGE_INDEX() as Promise<string>,
        pool.TOKEN() as Promise<string>,
        token.decimals() as Promise<bigint>,
      ]);
      if (!sameAddress(familyIndex, poolIndex) || !sameAddress(poolToken, config.tokenAddress)) {
        throw new Error(configurationMismatch);
      }
      const tokenDecimals = Number(decimals);
      if (!Number.isSafeInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) {
        throw new Error(invalidDecimals);
      }
      if (!cancelled) {
        setState({
          status: "ready",
          modules: {
            chainId: network.chainId,
            provider,
            deepFamily,
            lineageIndex: createLineageIndexContract(familyIndex, provider),
            token,
            pool,
            poolAddress,
            tokenDecimals,
          },
        });
      }
    };
    void load().catch((error: unknown) => {
      if (!cancelled) {
        setState({
          status: "unavailable",
          message: error instanceof Error ? error.message : unreachable,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    config.rpcUrl,
    config.chainId,
    config.contractAddress,
    config.tokenAddress,
    poolAddress,
    configurationMissing,
    configurationMismatch,
    invalidDecimals,
    unreachable,
  ]);

  const wrongNetwork = useMemo(
    () =>
      state.status === "ready" &&
      wallet.chainId !== null &&
      BigInt(wallet.chainId) !== state.modules.chainId,
    [state, wallet.chainId],
  );
  const head = <PageHead title={t("shielded.title")} subtitle={t("shielded.subtitle")} />;

  if (!wallet.address) {
    return (
      <PageContainer size="narrow" className="space-y-6 py-10">
        {head}
        <EmptyState
          size="page"
          icon={<Wallet className="h-7 w-7" strokeWidth={1.5} />}
          title={t("inheritance.gate.walletTitle")}
          description={t("shielded.connectWallet")}
          action={<WalletConnectButton className="mx-auto" alwaysShowLabel />}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer size="narrow" className="space-y-6 py-10">
      {head}
      {state.status === "loading" ? <p role="status">{t("shielded.loading")}</p> : null}
      {state.status === "unavailable" ? (
        <p
          role="alert"
          className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-ink"
        >
          {state.message}
        </p>
      ) : null}
      {wrongNetwork && state.status === "ready" ? (
        <div
          role="alert"
          className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-ink"
        >
          <p>{t("shielded.wrongNetwork", { chainId: String(state.modules.chainId) })}</p>
          <button
            type="button"
            className="mt-3 rounded-lg border border-hairline px-4 py-2"
            onClick={() => void wallet.switchOrAddChain(Number(state.modules.chainId))}
          >
            {t("inheritance.gate.switchNetwork")}
          </button>
        </div>
      ) : null}
      {state.status === "ready" && !wrongNetwork ? (
        <ShieldedInheritancePanel
          key={`${state.modules.chainId}:${state.modules.poolAddress}`}
          modules={state.modules}
          signer={wallet.signer}
          account={wallet.address}
          publicActivityAddresses={publicActivityAddresses.current}
        />
      ) : null}
    </PageContainer>
  );
}
