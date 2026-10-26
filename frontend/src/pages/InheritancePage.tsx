import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Contract, getAddress, ZeroAddress } from "ethers";
import { Wallet } from "lucide-react";
import { useConfig } from "../domains/config";
import {
  ShieldedInheritancePanel,
  ShieldedWalletSessionProvider,
  useShieldedWalletSession,
  ShieldedAssetToolbar,
  PanelButton,
  readShieldedAsset,
  resolveShieldedAssetPool,
  type ShieldedAsset,
  type ShieldedPageModules,
  type ShieldedPanelNavigation,
} from "../domains/inheritance";
import { useWallet, WalletConnectButton } from "../domains/wallet";
import { createShieldedPoolFactoryContract } from "../shared/clients/contractFactory";
import { getReadonlyProvider } from "../shared/clients/providerRegistry";
import { getLetterArchiveAddress, getShieldedPoolFactoryAddress } from "../shared/config/env";
import { SUPPORTED_NETWORKS } from "../shared/config/networks";
import { EmptyState, PageHead } from "../shared/ui";
import { configuredProofManifest as configuredPins } from "../shared/zk/proofConfiguration";

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
  return error instanceof Error ? { message: error.message } : { key: "shielded.unreachable" };
}

const INITIAL_NAVIGATION: ShieldedPanelNavigation = { action: "shield", taskChosen: false };

export default function InheritancePage() {
  const config = useConfig();
  const wallet = useWallet();
  const factoryAddress = getShieldedPoolFactoryAddress(config.chainId);
  const scope = `${config.chainId}:${factoryAddress}:${config.rpcUrl}`;
  const enabled =
    Boolean(wallet.address) && (wallet.chainId === null || wallet.chainId === config.chainId);
  return (
    <ShieldedWalletSessionProvider key={scope} enabled={enabled}>
      <InheritanceContent />
    </ShieldedWalletSessionProvider>
  );
}

function InheritanceContent() {
  const { t } = useTranslation();
  const config = useConfig();
  const wallet = useWallet();
  const { busy: sessionBusy } = useShieldedWalletSession();
  const currentSessionBusy = useRef(sessionBusy);
  currentSessionBusy.current = sessionBusy;
  const factoryAddress = getShieldedPoolFactoryAddress(config.chainId);
  const [selectedAddress, setSelectedAddress] = useState(config.tokenAddress);
  // Each pool remounts its panel; public navigation carries the current task across.
  const [navigation, setNavigation] = useState<ShieldedPanelNavigation>(INITIAL_NAVIGATION);
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
    const pins = configuredPins;
    if (!pins || !config.rpcUrl || !config.tokenAddress || !factoryAddress) {
      setState({ status: "unavailable", error: { key: "shielded.configurationMissing" } });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const mismatch = () => {
      if (!cancelled)
        setState({ status: "unavailable", error: { key: "shielded.configurationMismatch" } });
    };
    const load = async () => {
      const provider = getReadonlyProvider(config.rpcUrl, config.chainId);
      const factory = createShieldedPoolFactoryContract(factoryAddress, provider);
      const toBlock = await provider.getBlockNumber();
      const [network, registry, deepToken, asset] = await Promise.all([
        provider.getNetwork(),
        factory.RECEIVE_REGISTRY() as Promise<string>,
        factory.DEEP_TOKEN() as Promise<string>,
        readShieldedAsset(selectedAddress, provider, nativeSymbol, { blockTag: toBlock }),
      ]);
      if (
        network.chainId !== BigInt(config.chainId) ||
        !sameAddress(deepToken, config.tokenAddress) ||
        BigInt(pins.chainId) !== network.chainId ||
        !sameAddress(pins.registryAddress, registry)
      )
        return mismatch();
      const resolved = await resolveShieldedAssetPool(factory, asset, provider, {
        blockTag: toBlock,
      });
      if (!resolved) {
        if (!cancelled) setState({ status: "missingPool", asset });
        return;
      }
      const lettersAddress = getLetterArchiveAddress(config.chainId);
      if (lettersAddress) {
        const archive = new Contract(
          lettersAddress,
          ["function RECEIVE_REGISTRY() view returns(address)"],
          provider,
        );
        if (!sameAddress(await archive.RECEIVE_REGISTRY(), registry)) return mismatch();
      }
      if (!cancelled)
        setState({
          status: "ready",
          modules: {
            context: {
              rpcUrl: config.rpcUrl,
              deployment: {
                chainId: network.chainId,
                registryAddress: getAddress(registry),
                poolAddress: resolved.poolAddress,
                ...(lettersAddress ? { lettersAddress } : {}),
              },
              manifest: pins,
            },
            assetAddress: asset.address,
            assetSymbol: asset.symbol,
            tokenDecimals: asset.decimals,
          },
        });
    };
    void load().catch((error: unknown) => {
      if (!cancelled) setState({ status: "unavailable", error: pageError(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [
    config.rpcUrl,
    config.chainId,
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
  // Changing pools keeps the unlocked wallet; a running operation finishes first.
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
        <p className="max-w-md text-xs leading-relaxed text-ink-muted">
          {t("shielded.assets.importWarning")}
        </p>
      ) : null}
      {assetError ? (
        <p role="alert" className="max-w-md text-sm text-danger">
          {errorMessage(assetError)}
        </p>
      ) : null}
    </div>
  );

  if (!wallet.address) {
    return (
      <div className="mx-auto w-full max-w-[45rem] space-y-6">
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

  // The workspace spans the wider column; every other state is one focused narrow column.
  if (readyModules) {
    return (
      <div className="mx-auto w-full max-w-[70rem]">
        <ShieldedInheritancePanel
          key={`${readyModules.context.deployment.chainId}:${readyModules.context.deployment.poolAddress}`}
          modules={readyModules}
          signer={wallet.signer}
          account={wallet.address}
          head={head}
          assetControls={assetControls}
          navigation={navigation}
          onNavigationChange={setNavigation}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[45rem] space-y-6">
      {head}
      <div className="min-w-0 rounded-[20px] border border-hairline bg-surface px-4 py-3.5 sm:px-5">
        {assetControls}
      </div>
      {state.status === "missingPool" ? (
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">{t("shielded.assets.noPool")}</p>
          <PanelButton
            variant="primary"
            busy={creatingPool}
            disabled={creatingPool || wrongNetwork || !wallet.signer}
            onClick={() => void createPool()}
          >
            {t(creatingPool ? "shielded.assets.creating" : "shielded.assets.create")}
          </PanelButton>
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
          <PanelButton
            className="mt-3"
            onClick={() => void wallet.switchOrAddChain(config.chainId)}
          >
            {t("inheritance.gate.switchNetwork")}
          </PanelButton>
        </div>
      ) : null}
    </div>
  );
}
