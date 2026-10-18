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
  type ShieldedPanelNavigation,
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

type PageError =
  | {
      key:
        | "shielded.configurationMissing"
        | "shielded.configurationMismatch"
        | "shielded.unreachable"
        | "shielded.walletChanged"
        | "shielded.transactionFailed";
      values?: { hash: string };
    }
  | { message: string };

type ModulesState =
  | { status: "loading" }
  | { status: "unavailable"; error: PageError }
  | { status: "missingPool"; asset: ShieldedAsset }
  | { status: "ready"; modules: ShieldedPageModules };

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function pageError(error: unknown): PageError {
  return error instanceof Error
    ? { message: error.message }
    : { key: "shielded.unreachable" };
}

const INITIAL_NAVIGATION: ShieldedPanelNavigation = {
  slot: "identity",
  action: "shield",
  taskChosen: false,
};

export default function InheritancePage() {
  const config = useConfig();
  const wallet = useWallet();
  const factoryAddress = getShieldedPoolFactoryAddress(config.chainId);
  const scope = `${config.chainId}:${factoryAddress}:${config.contractAddress}:${config.rpcUrl}`;
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
  const { busy: sessionBusy, identity } = useShieldedPageIdentitySession();
  const currentSessionBusy = useRef(sessionBusy);
  currentSessionBusy.current = sessionBusy;
  const factoryAddress = getShieldedPoolFactoryAddress(config.chainId);
  const [selectedAssetAddress, setSelectedAddress] = useState(config.tokenAddress);
  // Each pool remounts its panel; public navigation carries the current task across.
  const [navigation, setNavigation] = useState<ShieldedPanelNavigation>(INITIAL_NAVIGATION);
  // Unlocking another person remounts it from the start, so no draft, selection or
  // task of the previous person carries over. Re-unlocking the same person keeps them.
  const [person, setPerson] = useState({ commitment: "", epoch: 0 });
  if (identity && identity.identityCommitment !== person.commitment) {
    const switched = person.commitment !== "";
    setPerson({
      commitment: identity.identityCommitment,
      epoch: person.epoch + (switched ? 1 : 0),
    });
    if (switched) setNavigation(INITIAL_NAVIGATION);
  }
  const selectedAddress = selectedAssetAddress;
  const [importAddress, setImportAddress] = useState("");
  const [importedAssets, setImportedAssets] = useState<ShieldedAsset[]>([]);
  const [creatingPool, setCreatingPool] = useState(false);
  const [importing, setImporting] = useState(false);
  const [assetError, setAssetError] = useState<PageError | null>(null);
  const [revision, setRevision] = useState(0);
  const nativeSymbol = SUPPORTED_NETWORKS[config.chainId]?.nativeCurrency.symbol ?? "Native";
  useEffect(() => {
    setSelectedAddress(config.tokenAddress);
    setImportedAssets([]);
    setImportAddress("");
    setImporting(false);
    setAssetError(null);
  }, [config.chainId, config.tokenAddress, factoryAddress]);
  const [state, setState] = useState<ModulesState>({ status: "loading" });
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
      setState({ status: "unavailable", error: { key: "shielded.configurationMissing" } });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const load = async () => {
      const provider = getReadonlyProvider(config.rpcUrl, config.chainId);
      const deepFamily = createDeepFamilyContract(config.contractAddress, provider);
      const factory = createShieldedPoolFactoryContract(factoryAddress, provider);
      const toBlock = await provider.getBlockNumber();
      const [network, familyIndex, deepToken, asset] = await Promise.all([
        provider.getNetwork(),
        deepFamily.lineageIndex() as Promise<string>,
        factory.DEEP_TOKEN() as Promise<string>,
        readShieldedAsset(selectedAddress, provider, nativeSymbol, { blockTag: toBlock }),
      ]);
      if (
        network.chainId !== BigInt(config.chainId) ||
        !sameAddress(deepToken, config.tokenAddress)
      ) {
        if (!cancelled)
          setState({ status: "unavailable", error: { key: "shielded.configurationMismatch" } });
        return;
      }
      const resolved = await resolveShieldedAssetPool(factory, asset, provider, familyIndex, {
        blockTag: toBlock,
      });
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
          error: pageError(error),
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
  ]);

  const wrongNetwork = useMemo(
    () => wallet.chainId !== null && wallet.chainId !== config.chainId,
    [config.chainId, wallet.chainId],
  );
  const importAsset = async () => {
    if (importing || sessionBusy) return;
    setImporting(true);
    setAssetError(null);
    const importingContext = assetContext;
    try {
      const provider = getReadonlyProvider(config.rpcUrl, config.chainId);
      const asset = await readShieldedAsset(
        getAddress(importAddress.trim()),
        provider,
        nativeSymbol,
        { blockTag: await provider.getBlockNumber() },
      );
      if (!mounted.current || currentAssetContext.current !== importingContext) return;
      setImportedAssets((assets) =>
        assets.some((item) => sameAddress(item.address, asset.address))
          ? assets
          : [...assets, asset],
      );
      // An operation may start while metadata loads. Keep its pool and draft;
      // the imported asset remains available for explicit selection afterward.
      if (!currentSessionBusy.current) setSelectedAddress(asset.address);
      setImportAddress("");
    } catch (error) {
      if (mounted.current && currentAssetContext.current === importingContext)
        setAssetError(pageError(error));
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
    setAssetError(null);
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
        if (isCurrent()) setAssetError({ key: "shielded.walletChanged" });
        return;
      }
      const factory = createShieldedPoolFactoryContract(factoryAddress, signer);
      const tx = await factory.createPool(asset.address);
      const receipt = await tx.wait();
      if (receipt?.status !== 1) {
        if (isCurrent())
          setAssetError({ key: "shielded.transactionFailed", values: { hash: tx.hash } });
        return;
      }
      // Re-read the canonical mapping after confirmation, including a concurrent creation.
      if (isCurrent()) setRevision((value) => value + 1);
    } catch (error) {
      if (isCurrent()) setAssetError(pageError(error));
    } finally {
      if (isCurrent()) setCreatingPool(false);
    }
  };
  const errorMessage = (error: PageError) =>
    "message" in error ? error.message : t(error.key, error.values);
  const head = <PageHead title={t("shielded.title")} />;
  const readyModules =
    state.status === "ready" &&
    !wrongNetwork &&
    sameAddress(selectedAddress, state.modules.assetAddress)
      ? state.modules
      : null;
  // Changing pools keeps the unlocked identity and funds root; the Worker drops only
  // the previous pool's history and prepared work. A running operation finishes first.
  const assetControls = (
    <div className="min-w-0 space-y-2">
      <ShieldedAssetToolbar
        selectedAddress={selectedAddress}
        deepTokenAddress={config.tokenAddress}
        nativeSymbol={nativeSymbol}
        importedAssets={importedAssets}
        disabled={creatingPool || sessionBusy}
        importing={importing}
        importAddress={importAddress}
        onImportAddressChange={setImportAddress}
        onImport={() => void importAsset()}
        onSelect={(address) => {
          setSelectedAddress(address);
          setAssetError(null);
        }}
      />
      {selectedAddress !== ZeroAddress && !sameAddress(selectedAddress, config.tokenAddress) ? (
        <p className="text-xs leading-relaxed text-ink-muted">
          {t("shielded.assets.importWarning")}
        </p>
      ) : null}
    </div>
  );

  if (!wallet.address) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6">
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
    <div className="mx-auto w-full max-w-4xl space-y-6">
      {head}
      {!readyModules ? (
        <div className="min-w-0 rounded-xl border border-hairline bg-surface px-4 py-3 sm:px-5">
          {assetControls}
        </div>
      ) : null}
      {assetError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(assetError)}
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
          {errorMessage(state.error)}
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
          key={`${readyModules.chainId}:${readyModules.poolAddress}:${person.epoch}`}
          modules={readyModules}
          signer={wallet.signer}
          account={wallet.address}
          assetControls={assetControls}
          navigation={navigation}
          onNavigationChange={setNavigation}
        />
      ) : null}
    </div>
  );
}
