import { useMemo, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Wallet } from "lucide-react";
import { useConfig } from "../domains/config";
import {
  InheritanceClaimPanel,
  InheritanceCreatePanel,
  InheritanceDepositPanel,
  InheritanceGate,
  InheritanceNotice,
  useInheritanceClaim,
  useInheritanceCreate,
  useInheritanceDeposit,
  useInheritanceModules,
  type InheritanceBlocker,
  type InheritanceSession,
} from "../domains/inheritance";
import { PersonHashCalculator, type PersonHashCalculatorHandle } from "../domains/person";
import { useWallet, WalletConnectButton } from "../domains/wallet";
import { EmptyState, PageContainer, PageHead } from "../shared/ui";

type InheritanceTab = "create" | "deposit" | "claim";

const TABS: readonly InheritanceTab[] = ["create", "deposit", "claim"];

function isTab(value: string | null): value is InheritanceTab {
  return TABS.includes(value as InheritanceTab);
}

function IdentityForm({
  formRef,
  onChange,
}: {
  formRef: RefObject<PersonHashCalculatorHandle>;
  onChange: () => void;
}) {
  return (
    <PersonHashCalculator
      ref={formRef}
      showTitle={false}
      collapsible={false}
      className="border-0 bg-transparent p-0 shadow-none"
      onPublicFormChange={onChange}
      onPassphraseChange={onChange}
    />
  );
}

export default function InheritancePage() {
  const { t } = useTranslation();
  const config = useConfig();
  const wallet = useWallet();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const tab: InheritanceTab = isTab(requestedTab) ? requestedTab : "create";

  const modulesState = useInheritanceModules({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    tokenAddress: config.tokenAddress,
  });
  // Compare against the chain the contracts are read on; a custom RPC has no configured id.
  const readChainId = modulesState.status === "ready" ? modulesState.modules.chainId : null;
  const wrongNetwork = Boolean(
    wallet.address && wallet.chainId && readChainId && wallet.chainId !== readChainId,
  );
  const blocker: InheritanceBlocker | null =
    modulesState.status === "blocked"
      ? modulesState.blocker
      : wrongNetwork
        ? "wrong-network"
        : null;

  const session = useMemo<InheritanceSession | null>(
    () =>
      modulesState.status === "ready" && wallet.signer && wallet.address && !wrongNetwork
        ? { modules: modulesState.modules, signer: wallet.signer, account: wallet.address }
        : null,
    [modulesState, wallet.signer, wallet.address, wrongNetwork],
  );

  const createRootRef = useRef<PersonHashCalculatorHandle>(null);
  const claimHeirRef = useRef<PersonHashCalculatorHandle>(null);
  const claimRootRef = useRef<PersonHashCalculatorHandle>(null);
  const create = useInheritanceCreate(session, createRootRef);
  const deposit = useInheritanceDeposit(session);
  const claim = useInheritanceClaim(session, claimHeirRef, claimRootRef);

  // Leaving a tab unmounts its identity forms, so whatever they fed is stale.
  const selectTab = (next: InheritanceTab) => {
    if (next === tab) return;
    create.reset();
    claim.reset();
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  const head = <PageHead title={t("inheritance.title")} subtitle={t("inheritance.subtitle")} />;

  if (!wallet.address) {
    return (
      <PageContainer size="narrow" className="space-y-6 py-10">
        {head}
        <InheritanceNotice />
        <EmptyState
          size="page"
          icon={<Wallet className="h-7 w-7" strokeWidth={1.5} />}
          title={t("inheritance.gate.walletTitle")}
          description={t("inheritance.gate.walletDescription")}
          action={<WalletConnectButton className="mx-auto" alwaysShowLabel />}
        />
      </PageContainer>
    );
  }

  const disabled = session === null;
  const recentReward = modulesState.status === "ready" ? modulesState.modules.recentReward : 0n;

  return (
    <PageContainer size="narrow" className="space-y-6 py-10">
      {head}
      <InheritanceNotice />
      {blocker ? (
        <InheritanceGate
          blocker={blocker}
          onSwitchNetwork={() => {
            if (readChainId) void wallet.switchOrAddChain(readChainId);
          }}
        />
      ) : null}

      <div
        role="tablist"
        aria-label={t("inheritance.title")}
        className="inline-flex rounded-xl border border-hairline bg-surface-muted p-1"
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`inheritance-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="inheritance-tabpanel"
            onClick={() => selectTab(id)}
            className={`h-9 rounded-lg px-4 text-sm font-semibold transition-colors ${
              tab === id ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t(`inheritance.tabs.${id}`)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="inheritance-tabpanel" aria-labelledby={`inheritance-tab-${tab}`}>
        {tab === "create" ? (
          <InheritanceCreatePanel
            rootIdentityForm={<IdentityForm formRef={createRootRef} onChange={create.reset} />}
            state={create.state}
            recentReward={recentReward}
            disabled={disabled}
            onReview={(input) => void create.review(input)}
            onConfirm={() => void create.confirm()}
            onReset={create.reset}
          />
        ) : tab === "deposit" ? (
          <InheritanceDepositPanel
            state={deposit.state}
            disabled={disabled}
            onLookup={(id) => void deposit.lookup(id)}
            onDeposit={(amount) => void deposit.deposit(amount)}
            onReset={deposit.reset}
          />
        ) : (
          <InheritanceClaimPanel
            heirIdentityForm={<IdentityForm formRef={claimHeirRef} onChange={claim.reset} />}
            rootIdentityForm={<IdentityForm formRef={claimRootRef} onChange={claim.reset} />}
            state={claim.state}
            account={wallet.address}
            disabled={disabled}
            onSearch={(rootVersionIndex) => void claim.search(rootVersionIndex)}
            onClaim={(id, recipient) => void claim.claim(id, recipient)}
            onReset={claim.reset}
          />
        )}
      </div>
    </PageContainer>
  );
}
