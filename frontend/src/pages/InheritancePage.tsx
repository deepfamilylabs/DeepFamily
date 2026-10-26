import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Contract, getAddress, ZeroAddress } from "ethers";
import { useConfig } from "../domains/config";
import { useWallet } from "../domains/wallet";
import { getReadonlyProvider } from "../shared/clients/providerRegistry";
import { createShieldedPoolFactoryContract } from "../shared/clients/contractFactory";
import { getLetterArchiveAddress, getShieldedPoolFactoryAddress } from "../shared/config/env";
import { SUPPORTED_NETWORKS } from "../shared/config/networks";
import {
  FIELD_INPUT,
  FieldBlock,
  InheritanceWorkspace,
  readShieldedAsset,
  resolveShieldedAssetPool,
} from "../domains/inheritance";
import { PageHead } from "../shared/ui";
import { configuredProofManifest as configuredPins } from "../shared/zk/proofConfiguration";
import type { ReceiveWorkerContext } from "../shared/workers/receiveWorkerClient";

type Ready = { scope: string; assetAddress: string; context: ReceiveWorkerContext; symbol: string; decimals: number | null };
export default function InheritancePage() {
  const config = useConfig(), wallet = useWallet(), { t } = useTranslation();
  const [selected, setSelected] = useState(config.tokenAddress || ZeroAddress);
  const [ready, setReady] = useState<Ready | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const factoryAddress = getShieldedPoolFactoryAddress(config.chainId);
  const scope = `${config.chainId}:${factoryAddress}:${config.rpcUrl}`;
  const activeReady = ready?.scope === scope && ready.assetAddress === selected ? ready : null;
  useEffect(() => { setSelected(config.tokenAddress || ZeroAddress); setReady(null); }, [scope, config.tokenAddress]);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    void (async () => {
      if (!configuredPins || !config.rpcUrl || !factoryAddress || !config.tokenAddress) throw new Error(t("shielded.configurationMissing"));
      const provider = getReadonlyProvider(config.rpcUrl, config.chainId);
      const factory = createShieldedPoolFactoryContract(factoryAddress, provider);
      const [network, registry, token, toBlock] = await Promise.all([provider.getNetwork(), factory.RECEIVE_REGISTRY() as Promise<string>, factory.DEEP_TOKEN() as Promise<string>, provider.getBlockNumber()]);
      if (network.chainId !== BigInt(config.chainId) || getAddress(token) !== getAddress(config.tokenAddress) || BigInt(configuredPins.chainId) !== network.chainId || getAddress(configuredPins.registryAddress) !== getAddress(registry)) throw new Error(t("shielded.configurationMismatch"));
      const nativeSymbol = SUPPORTED_NETWORKS[config.chainId]?.nativeCurrency.symbol ?? "Native";
      const asset = await readShieldedAsset(selected, provider, nativeSymbol, { blockTag: toBlock });
      const resolved = await resolveShieldedAssetPool(factory, asset, provider, { blockTag: toBlock });
      if (!resolved) throw new Error(t("shielded.assets.noPool"));
      const lettersAddress = getLetterArchiveAddress(config.chainId);
      if (lettersAddress) {
        const archive = new Contract(lettersAddress, ["function RECEIVE_REGISTRY() view returns(address)"], provider);
        if (getAddress(await archive.RECEIVE_REGISTRY()) !== getAddress(registry)) throw new Error(t("shielded.configurationMismatch"));
      }
      if (!cancelled) setReady({ scope, assetAddress: selected, symbol: asset.symbol, decimals: asset.decimals, context: { rpcUrl: config.rpcUrl,
        deployment: { chainId: network.chainId, registryAddress: getAddress(registry), poolAddress: resolved.poolAddress, ...(lettersAddress ? { lettersAddress } : {}) }, manifest: configuredPins } });
    })().catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : t("shielded.unreachable")); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, selected, config.chainId, config.rpcUrl, config.tokenAddress, factoryAddress, t]);
  const wrongNetwork = wallet.chainId !== null && wallet.chainId !== config.chainId;
  return <div className="mx-auto max-w-[52rem] space-y-6">
    <PageHead title={t("walletProtocol.title")} />
    <FieldBlock label={t("walletProtocol.asset")}><select className={FIELD_INPUT} value={selected} onChange={event => setSelected(event.target.value)} disabled={loading}><option value={config.tokenAddress}>{t("walletProtocol.projectToken")}</option><option value={ZeroAddress}>{SUPPORTED_NETWORKS[config.chainId]?.nativeCurrency.symbol ?? "Native"}</option></select></FieldBlock>
    {error ? <p role="alert" className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm">{error}</p> : null}
    {wrongNetwork ? <p role="alert" className="text-sm text-warning">{t("shielded.walletChanged")}</p> : null}
    {loading && !activeReady ? <p role="status">{t("shielded.loading")}</p> : null}
    {activeReady ? <InheritanceWorkspace key={`${scope}:${activeReady.context.deployment.registryAddress}`} context={activeReady.context} symbol={activeReady.symbol} decimals={activeReady.decimals}
      signer={wrongNetwork ? null : wallet.signer} account={wallet.address} loading={loading || Boolean(error)} /> : null}
  </div>;
}
