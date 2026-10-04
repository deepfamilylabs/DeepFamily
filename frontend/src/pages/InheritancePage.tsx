import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wallet } from "lucide-react";
import { useConfig } from "../domains/config";
import {
  ShieldedInheritancePanel,
  ShieldedIdentitySessionProvider,
  useShieldedPageIdentitySession,
  ShieldedAssetToolbar,
  readShieldedAsset,
  resolveShieldedAssetPool,
  type ShieldedAsset,
  type ShieldedPageModules,
} from "../domains/inheritance";
import { useWallet, WalletConnectButton } from "../domains/wallet";
import {
  createDeepFamilyContract,
  createShieldedPoolFactoryContract,
  createLineageIndexContract,
} from "../shared/clients/contractFactory";
import { getReadonlyProvider } from "../shared/clients/providerRegistry";
import { getShieldedPoolFactoryAddress } from "../shared/config/env";
import { getAddress, ZeroAddress } from "ethers";
import { SUPPORTED_NETWORKS } from "../shared/config/networks";
import { EmptyState, PageHead } from "../shared/ui";

type ModulesState =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "missingPool"; asset: ShieldedAsset }
  | { status: "ready"; modules: ShieldedPageModules };

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export default function InheritancePage() {
  const config = useConfig();
  const wallet = useWallet();
  const factoryAddress = getShieldedPoolFactoryAddress(config.chainId);
  const scope = `${config.chainId}:${factoryAddress}:${config.contractAddress}`;
  const enabled =
    Boolean(wallet.address) && (wallet.chainId === null || wallet.chainId === config.chainId);
  return (
    <ShieldedIdentitySessionProvider key={scope} scope={scope} enabled={enabled}>
      <InheritanceContent />
    </ShieldedIdentitySessionProvider>
  );
}

function InheritanceContent() {
  const { t } = useTranslation();
  const config = useConfig();
  const wallet = useWallet();
  const { identity } = useShieldedPageIdentitySession();
  const factoryAddress = getShieldedPoolFactoryAddress(config.chainId);
  const [selectedAssetAddress, setSelectedAddress] = useState(config.tokenAddress);
  // Keep the unlock entry reachable even if a selected pool is missing or unavailable.
  const selectedAddress = identity ? selectedAssetAddress : config.tokenAddress;
  const [importAddress, setImportAddress] = useState("");
  const [importedAssets, setImportedAssets] = useState<ShieldedAsset[]>([]);
  const [creatingPool, setCreatingPool] = useState(false);
  const [importing, setImporting] = useState(false);
  const [assetError, setAssetError] = useState("");
  const [revision, setRevision] = useState(0);
  const nativeSymbol = SUPPORTED_NETWORKS[config.chainId]?.nativeCurrency.symbol ?? "Native";
  useEffect(() => {
    setSelectedAddress(config.tokenAddress);
    setImportedAssets([]);
    setImportAddress("");
    setImporting(false);
    setAssetError("");
  }, [config.chainId, config.tokenAddress, factoryAddress]);
  const configurationMissing = t("shielded.configurationMissing");
  const configurationMismatch = t("shielded.configurationMismatch");
  const unreachable = t("shielded.unreachable");
  const [state, setState] = useState<ModulesState>({ status: "loading" });
  // Remember deposits across wallet switches during this page visit so the
  // panel can explain the privacy implications of reusing a deposit wallet.
  const publicActivityAddresses = useRef(new Set<string>());
  const assetContext = `${config.chainId}:${factoryAddress}`;
  const currentAssetContext = useRef(assetContext);
  currentAssetContext.current = assetContext;
  const currentPoolOperation = useRef({
    assetContext,
    selectedAddress,
    signer: wallet.signer,
    account: wallet.address,
  });
  currentPoolOperation.current = {
    assetContext,
    selectedAddress,
    signer: wallet.signer,
    account: wallet.address,
  };
  const poolCreationEpoch = useRef(0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      poolCreationEpoch.current += 1;
    };
  }, []);
  useLayoutEffect(() => {
    poolCreationEpoch.current += 1;
    setCreatingPool(false);
  }, [assetContext, selectedAddress, wallet.signer, wallet.address]);

  useEffect(() => {
    if (!config.rpcUrl || !config.contractAddress || !config.tokenAddress || !factoryAddress) {
      setState({ status: "unavailable", message: configurationMissing });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const load = async () => {
      const provider = getReadonlyProvider(config.rpcUrl, config.chainId);
      const deepFamily = createDeepFamilyContract(config.contractAddress, provider);
      const factory = createShieldedPoolFactoryContract(factoryAddress, provider);
      const [network, familyIndex, deepToken, asset] = await Promise.all([
        provider.getNetwork(),
        deepFamily.lineageIndex() as Promise<string>,
        factory.DEEP_TOKEN() as Promise<string>,
        readShieldedAsset(selectedAddress, provider, nativeSymbol),
      ]);
      if (
        network.chainId !== BigInt(config.chainId) ||
        !sameAddress(deepToken, config.tokenAddress)
      ) {
        throw new Error(configurationMismatch);
      }
      const resolved = await resolveShieldedAssetPool(factory, asset, provider, familyIndex);
      if (!resolved) {
        if (!cancelled) setState({ status: "missingPool", asset });
        return;
      }
      const { pool, poolAddress, poolDeploymentBlock } = resolved;
      if (!cancelled) {
        setState({
          status: "ready",
          modules: {
            chainId: network.chainId,
            provider,
            deepFamily,
            lineageIndex: createLineageIndexContract(familyIndex, provider),
            token: asset.token,
            assetAddress: asset.address,
            assetKind: asset.kind,
            assetSymbol: asset.symbol,
            factory,
            pool,
            poolAddress,
            tokenDecimals: asset.decimals,
            poolDeploymentBlock,
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
    factoryAddress,
    selectedAddress,
    nativeSymbol,
    revision,
    configurationMissing,
    configurationMismatch,
    unreachable,
  ]);

  const wrongNetwork = useMemo(
    () => wallet.chainId !== null && wallet.chainId !== config.chainId,
    [config.chainId, wallet.chainId],
  );
  const importAsset = async () => {
    if (importing) return;
    setImporting(true);
    setAssetError("");
    const importingContext = assetContext;
    try {
      const provider = getReadonlyProvider(config.rpcUrl, config.chainId);
      const asset = await readShieldedAsset(
        getAddress(importAddress.trim()),
        provider,
        nativeSymbol,
      );
      if (!mounted.current || currentAssetContext.current !== importingContext) return;
      setImportedAssets((assets) =>
        assets.some((item) => sameAddress(item.address, asset.address))
          ? assets
          : [...assets, asset],
      );
      setSelectedAddress(asset.address);
      setImportAddress("");
    } catch (error) {
      if (mounted.current && currentAssetContext.current === importingContext)
        setAssetError(error instanceof Error ? error.message : unreachable);
    } finally {
      if (mounted.current && currentAssetContext.current === importingContext) setImporting(false);
    }
  };
  const createPool = async () => {
    if (state.status !== "missingPool" || !wallet.signer || wrongNetwork || !factoryAddress) return;
    const signer = wallet.signer;
    const asset = state.asset;
    const context = currentPoolOperation.current;
    const epoch = poolCreationEpoch.current;
    const isCurrent = () =>
      mounted.current &&
      poolCreationEpoch.current === epoch &&
      currentPoolOperation.current.assetContext === context.assetContext &&
      currentPoolOperation.current.selectedAddress === asset.address &&
      currentPoolOperation.current.signer === signer &&
      currentPoolOperation.current.account === context.account;
    setCreatingPool(true);
    setAssetError("");
    try {
      const [network, signerAddress] = await Promise.all([
        signer.provider?.getNetwork(),
        signer.getAddress(),
      ]);
      if (
        !isCurrent() ||
        network?.chainId !== BigInt(config.chainId) ||
        !context.account ||
        !sameAddress(signerAddress, context.account)
      ) {
        throw new Error(t("shielded.walletChanged"));
      }
      const factory = createShieldedPoolFactoryContract(factoryAddress, signer);
      const tx = await factory.createPool(asset.address);
      const receipt = await tx.wait();
      if (receipt?.status !== 1)
        throw new Error(t("shielded.transactionFailed", { hash: tx.hash }));
      // Re-read the canonical mapping after confirmation, including a concurrent creation.
      if (isCurrent()) setRevision((value) => value + 1);
    } catch (error) {
      if (isCurrent()) setAssetError(error instanceof Error ? error.message : unreachable);
    } finally {
      if (isCurrent()) setCreatingPool(false);
    }
  };
  const head = <PageHead title={t("shielded.title")} />;
  const readyModules =
    state.status === "ready" &&
    !wrongNetwork &&
    sameAddress(selectedAddress, state.modules.assetAddress)
      ? state.modules
      : null;
  const assetControls = identity ? (
    <div className="min-w-0 space-y-2">
      <ShieldedAssetToolbar
        selectedAddress={selectedAddress}
        deepTokenAddress={config.tokenAddress}
        nativeSymbol={nativeSymbol}
        importedAssets={importedAssets}
        disabled={creatingPool}
        importing={importing}
        importAddress={importAddress}
        onImportAddressChange={setImportAddress}
        onImport={() => void importAsset()}
        onSelect={(address) => {
          setSelectedAddress(address);
          setAssetError("");
        }}
      />
      {selectedAddress !== ZeroAddress && !sameAddress(selectedAddress, config.tokenAddress) ? (
        <p className="text-xs leading-relaxed text-ink-muted">{t("shielded.assets.importWarning")}</p>
      ) : null}
    </div>
  ) : null;

  if (!wallet.address) {
    return (
      <div className="space-y-6">
        {head}
        <EmptyState
          size="page"
          icon={<Wallet className="h-7 w-7" strokeWidth={1.5} />}
          title={t("inheritance.gate.walletTitle")}
          description={t("shielded.connectWallet")}
          action={<WalletConnectButton className="mx-auto" alwaysShowLabel />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {head}
      {assetControls && !readyModules ? (
        <div className="min-w-0 rounded-xl border border-hairline bg-surface px-4 py-3 sm:px-5">
          {assetControls}
        </div>
      ) : null}
      {assetError ? (
        <p role="alert" className="text-sm text-danger">
          {assetError}
        </p>
      ) : null}
      {state.status === "missingPool" ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">{t("shielded.assets.noPool")}</p>
          <button
            type="button"
            disabled={creatingPool || wrongNetwork || !wallet.signer}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-on-primary"
            onClick={() => void createPool()}
          >
            {t(creatingPool ? "shielded.assets.creating" : "shielded.assets.create")}
          </button>
        </div>
      ) : null}
      {state.status === "loading" ? <p role="status">{t("shielded.loading")}</p> : null}
      {state.status === "unavailable" ? (
        <p
          role="alert"
          className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-ink"
        >
          {state.message}
        </p>
      ) : null}
      {wrongNetwork ? (
        <div
          role="alert"
          className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-ink"
        >
          <p>{t("shielded.wrongNetwork", { chainId: String(config.chainId) })}</p>
          <button
            type="button"
            className="mt-3 rounded-lg border border-hairline px-4 py-2"
            onClick={() => void wallet.switchOrAddChain(config.chainId)}
          >
            {t("inheritance.gate.switchNetwork")}
          </button>
        </div>
      ) : null}
      {readyModules ? (
        <ShieldedInheritancePanel
          key={`${readyModules.chainId}:${readyModules.poolAddress}`}
          modules={readyModules}
          signer={wallet.signer}
          account={wallet.address}
          publicActivityAddresses={publicActivityAddresses.current}
          assetControls={assetControls}
        />
      ) : null}
    </div>
  );
}
